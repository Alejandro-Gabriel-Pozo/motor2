import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { guardarPermisosCasoDeUso } from "../../src/server/actions/permisos/casos-de-uso/guardar-permisos";
import { SIN_PERMISO } from "../../src/core/permisos/matriz";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * ─── El paso de O.35 «releer el rol dentro de la transacción» edita este archivo a propósito ───────────────────────────────────────────────────────────
 *
 * Hueco de cobertura informado en la Fase I (I.3 del Hito 3): `guardarPermisos` lee los roles y las acciones FUERA de la transacción, a propósito (lo explica
 * el comentario de `casos-de-uso/guardar-permisos.ts`: adentro tomarían un bloqueo de predicado sobre `Rol` con `activo: true`, y activar o desactivar
 * cualquier rol chocaría con un guardado de la matriz), y relee ADENTRO solo las celdas de `PermisoRol` (el chequeo optimista contra lo que la persona vio).
 * Nada lo vigilaba: mover esas lecturas adentro (o sacar la relectura de la matriz) no ponía ningún test en rojo.
 *
 * Cómo se vigila, sin depender de tiempos: el caso de uso recibe un actor cuya base (`db`) y cuya transacción anotan, EN ORDEN, cada operación que pasa por
 * ellas («db:Modelo.operación», «abre la transacción», «tx:modelo.operación»). La base es la de prueba y la transacción es la de la empresa de prueba: el
 * guardado se hace de verdad.
 */
describe("guardarPermisos: qué lee fuera de la transacción y qué relee adentro", () => {
  let operadorRolId: string;
  let adminId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    operadorRolId = base.operador.id;
    // La auditoría necesita un actor que exista (clave foránea de `RegistroAuditoria.actorId`).
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
  });

  /** Una transacción que anota cada operación de su `tx` (un Proxy por modelo: el cliente de una transacción no se puede extender). */
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
                registro.push(`tx:${prop}.${operacion}`);
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
    return { usuarioId: adminId, db, transaccion };
  }

  it("lee el rol y la acción con `db` ANTES de abrir la transacción, y adentro relee solo la matriz (y escribe y audita)", async () => {
    const registro: string[] = [];
    const r = await guardarPermisosCasoDeUso(actorEspiado(registro), [{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r.ok, r.mensaje).toBe(true);

    const apertura = registro.indexOf("abre la transacción");
    expect(apertura, registro.join("\n")).toBeGreaterThan(0);
    const antes = registro.slice(0, apertura);
    const despues = registro.slice(apertura + 1);

    // Afuera: exactamente las dos lecturas de validación, por la base del actor.
    expect([...antes].sort()).toEqual(["db:Accion.findMany", "db:Rol.findMany"]);
    // Adentro: nada por la base de afuera, nada de `Rol` ni de `Accion`, y sí la relectura de la matriz antes de escribirla.
    expect(despues.filter((o) => o.startsWith("db:")), registro.join("\n")).toEqual([]);
    expect(despues.filter((o) => /^tx:(rol|accion)\./.test(o)), registro.join("\n")).toEqual([]);
    const relectura = despues.indexOf("tx:permisoRol.findMany");
    expect(relectura, registro.join("\n")).toBeGreaterThanOrEqual(0);
    expect(despues.findIndex((o) => o === "tx:permisoRol.upsert"), registro.join("\n")).toBeGreaterThan(relectura);
  });
});
