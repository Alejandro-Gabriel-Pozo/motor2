import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { guardarPermisosCasoDeUso } from "../../src/server/actions/permisos/casos-de-uso/guardar-permisos";
import { SIN_PERMISO } from "../../src/core/permisos/matriz";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * ─── Editado A PROPÓSITO por O35-C (O.35, «releer el rol dentro de la transacción»; `docs/plan-hito-3-pureza.md` §9) ──────────────────────────────────────────
 *
 * Este archivo nació (`5aa0c9b2`, como `guardar-permisos-lecturas-fuera-de-la-transaccion.test.ts`) para fijar el comportamiento ANTERIOR: `guardarPermisos`
 * leía el rol y la acción FUERA de la transacción, con `actor.db`, y adentro releía solo las celdas de `PermisoRol`. Su encabezado decía que el paso de O.35 lo
 * editaba; O35-C lo renombró y ahora fija el comportamiento NUEVO:
 *  - nada pasa por la base de afuera (`db`): el caso de uso abre la transacción antes de leer nada;
 *  - adentro lee el ROL (por id, SIN `activo` en el `where`: si está activo se mira en JS, para no tomar un bloqueo de predicado sobre «todos los roles
 *    activos») y la ACCIÓN, después relee la matriz (el chequeo optimista contra lo que la persona vio) y recién ahí escribe.
 *
 * Cómo se vigila, sin depender de tiempos: el caso de uso recibe un actor cuya base (`db`) y cuya transacción anotan, EN ORDEN, cada operación que pasa por
 * ellas («db:Modelo.operación», «abre la transacción», «tx:modelo.operación»; la del rol, con su `where`). La base es la de prueba y la transacción es la de la
 * empresa de prueba: el guardado se hace de verdad.
 */
describe("guardarPermisos: lee el rol y la acción dentro de la transacción (O35-C)", () => {
  let operadorRolId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    operadorRolId = base.operador.id;
    // La auditoría necesita un actor que exista (clave foránea de `RegistroAuditoria.actorId`).
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
  });

  /** Una transacción que anota cada operación de su `tx` (un Proxy por modelo: el cliente de una transacción no se puede extender). La de `rol`, con su `where`. */
  function espiarTx(tx: Prisma.TransactionClient, registro: string[]): Prisma.TransactionClient {
    return new Proxy(tx, {
      get(objetivo, prop, receptor) {
        const valor: unknown = Reflect.get(objetivo, prop, receptor);
        if (typeof prop === "string" && valor !== null && typeof valor === "object" && "findMany" in valor) {
          return new Proxy(valor, {
            get(modelo, operacion, r) {
              const f: unknown = Reflect.get(modelo, operacion, r);
              if (typeof f !== "function" || typeof operacion !== "string") return f;
              return (...args: unknown[]) => {
                const where = prop === "rol" ? ` ${JSON.stringify(Object.keys((args[0] as { where?: object } | undefined)?.where ?? {}))}` : "";
                registro.push(`tx:${prop}.${operacion}${where}`);
                return (f as (...a: unknown[]) => unknown).apply(modelo, args);
              };
            },
          });
        }
        return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
      },
    });
  }

  function actorEspiado(registro: string[]) {
    // `db` va aunque el caso de uso ya no la pida: si alguna lectura volviera a salir por la base de afuera, quedaría anotada.
    const db = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            registro.push(`db:${model}.${operation}`);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const transaccion: Transaccion = Object.assign(
      <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: Parameters<Transaccion>[1]) => {
        registro.push("abre la transacción");
        return baseDeTest.transaccion((tx) => fn(espiarTx(tx, registro)), opciones);
      },
      { aleatorio: () => 0 },
    );
    return { usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, db, transaccion };
  }

  it("abre la transacción antes de leer nada; adentro lee el rol (por id, sin `activo` en el where) y la acción, relee la matriz y recién ahí escribe", async () => {
    const registro: string[] = [];
    const r = await guardarPermisosCasoDeUso(actorEspiado(registro), [{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r.ok, r.mensaje).toBe(true);

    // Nada por la base de afuera, y lo primero es abrir la transacción.
    expect(registro.filter((o) => o.startsWith("db:")), registro.join("\n")).toEqual([]);
    expect(registro[0], registro.join("\n")).toBe("abre la transacción");

    // Adentro: el rol por su id (el where tiene SOLO `id`) y la acción, los dos antes de la relectura de la matriz, que va antes de la escritura.
    const rol = registro.indexOf('tx:rol.findMany ["id"]');
    const accion = registro.indexOf("tx:accion.findMany");
    const relectura = registro.indexOf("tx:permisoRol.findMany");
    const escritura = registro.indexOf("tx:permisoRol.upsert");
    expect(registro.filter((o) => o.startsWith("tx:rol.")), registro.join("\n")).toEqual(['tx:rol.findMany ["id"]']);
    expect(rol, registro.join("\n")).toBeGreaterThan(0);
    expect(accion, registro.join("\n")).toBeGreaterThan(0);
    expect(relectura, registro.join("\n")).toBeGreaterThan(Math.max(rol, accion));
    expect(escritura, registro.join("\n")).toBeGreaterThan(relectura);
  });

  it("un rol desactivado (leído adentro, mirado en JS) sigue rechazándose «¿está desactivado?» sin guardar nada", async () => {
    await prisma.rol.update({ where: { id: operadorRolId }, data: { activo: false } });
    const foto = () => prisma.permisoRol.findMany({ where: { rolId: operadorRolId }, orderBy: { accionClave: "asc" } });
    const antes = await foto();
    const registro: string[] = [];
    const r = await guardarPermisosCasoDeUso(actorEspiado(registro), [{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r).toEqual({ ok: false, codigo: "ROL_NO_ENCONTRADO", mensaje: "No se encontró uno de los roles (¿está desactivado?). No se guardó nada." });
    expect(registro.filter((o) => o.startsWith("tx:permisoRol.")), registro.join("\n")).toEqual([]);
    expect(await foto()).toEqual(antes);
  });
});
