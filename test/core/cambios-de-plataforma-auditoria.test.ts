import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import { cambiarPoliticaDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";

/**
 * S-33 (decisión del dueño, 2026-10-08): «el admin de plataforma no es User y no debe serlo». Los scripts `modulos-empresa` y `politica-empresa` exigían que `--actor` fuera un
 * `AdminPlataforma` activo Y un `User` con el mismo email (la auditoría era `RegistroAuditoria`, cuyo `actorId` apunta a `User`): el dueño es dos cuentas distintas y no podía correrlos.
 * Ahora el actor es SOLO un administrador de plataforma (ya verificado por quien llama contra la base de identidad de la consola) y el cambio se audita en `AuditoriaPlataforma`
 * (sin clave foránea a `User`), en la MISMA transacción que el cambio, con la instalación en el `detalle`. Estos tests son el ataque contra el código anterior: sin ningún `User` en la
 * base, la operación tenía que fallar con «No existe un usuario» y, cuando andaba, escribía en el registro de la empresa y no en el de plataforma.
 */
const NORTE = "norte";
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-del-dueno", adminEmail: "dueno@plataforma.test", instalacionId: "zuluhub", instalacionNombre: "Zuluhub" };

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } });
});

const auditoria = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });

/**
 * Un cliente que falla en la N-ésima llamada de `modelo.operacion` DENTRO de la transacción: reproduce «el cambio se revierte» para comprobar que la fila de auditoría se revierte con él.
 * Todo lo demás pasa al cliente real.
 */
function conFallaEn(modelo: string, operacion: string, enLaLlamada: number): PrismaClient {
  let llamadas = 0;
  return new Proxy(prismaAdmin, {
    get(base, propiedad) {
      if (propiedad !== "$transaction") return Reflect.get(base, propiedad);
      return (funcion: (tx: object) => Promise<unknown>, opciones?: object) =>
        base.$transaction(
          (tx) =>
            funcion(
              new Proxy(tx, {
                get(transaccion, p) {
                  const valor = Reflect.get(transaccion, p);
                  if (p !== modelo) return valor;
                  return new Proxy(valor as object, {
                    get(delegado, o) {
                      const metodo = Reflect.get(delegado, o);
                      if (o !== operacion) return metodo;
                      return (...argumentos: unknown[]) => {
                        llamadas += 1;
                        if (llamadas === enLaLlamada) throw new Error("falla de prueba");
                        return Reflect.apply(metodo as (...a: unknown[]) => unknown, delegado, argumentos);
                      };
                    },
                  });
                },
              }),
            ),
          opciones,
        );
    },
  }) as PrismaClient;
}

describe("módulos: el cambio se audita en AuditoriaPlataforma a nombre del administrador, sin ningún User", () => {
  it("activar un módulo con CERO usuarios en la base funciona y deja la fila de plataforma (no la de la empresa)", async () => {
    expect(await prismaAdmin.user.count(), "el escenario no tiene ningún User").toBe(0);

    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR);

    expect(r.cambiados).toEqual([{ modulo: "stock", antes: null, despues: "ACTIVO" }]);
    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      adminId: AUTOR.adminId,
      adminEmail: AUTOR.adminEmail,
      accion: "modulo-activado",
      empresaAfectadaId: NORTE,
      detalle: { modulo: "stock", antes: "sin fila", despues: "ACTIVO", origen: "script", instalacion: "zuluhub", instalacionNombre: "Zuluhub" },
    });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "ModuloEmpresa" } }), "ya no escribe en el registro de la empresa").toBe(0);
    expect(await prismaAdmin.user.count(), "no crea ningún User").toBe(0);
  });

  it("desactivar deja otra fila con la acción de desactivar y el antes; pedir lo que ya está así no deja ninguna", async () => {
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock", "carta"] }, AUTOR);
    await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", desactivar: ["carta"] }, AUTOR);
    const r = await cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR);

    expect(r.cambiados).toEqual([]);
    const filas = await auditoria();
    expect(filas.map((f) => [f.accion, (f.detalle as { modulo: string }).modulo])).toEqual([
      ["modulo-activado", "stock"],
      ["modulo-activado", "carta"],
      ["modulo-desactivado", "carta"],
    ]);
    expect(filas[2].detalle).toMatchObject({ antes: "ACTIVO", despues: "INACTIVO" });
  });

  it("es atómico con el cambio: si falla el segundo módulo, no queda ni el primero ni su fila de auditoría", async () => {
    // Mutación: auditar con `db` en vez de con `tx` deja la fila del primer módulo aunque el cambio se revierta.
    const db = conFallaEn("moduloEmpresa", "upsert", 2);
    await expect(cambiarModulosDeEmpresa(db, { slug: "norte", activar: ["stock", "carta"] }, AUTOR)).rejects.toThrow("falla de prueba");
    expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId: NORTE } }), "el primer upsert se revirtió").toBe(0);
    expect(await auditoria(), "la fila del primer módulo se revirtió con él").toEqual([]);
  });
});

describe("política: el cambio se audita en AuditoriaPlataforma a nombre del administrador, sin ningún User", () => {
  it("el perfil lite con CERO usuarios en la base funciona y deja una fila por perilla que cambió", async () => {
    expect(await prismaAdmin.user.count(), "el escenario no tiene ningún User").toBe(0);

    const r = await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR);

    expect([...r.cambiadas].sort()).toEqual(["dosPaneles", "permisosEditables"]);
    const filas = await auditoria();
    expect(filas.map((f) => (f.detalle as { perilla: string }).perilla).sort()).toEqual(["dosPaneles", "permisosEditables"]);
    for (const f of filas) {
      expect(f).toMatchObject({ adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail, accion: "politica-cambiada", empresaAfectadaId: NORTE });
      expect(f.detalle).toMatchObject({ antes: true, despues: false, origen: "script", instalacion: "zuluhub", instalacionNombre: "Zuluhub" });
    }
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Empresa" } }), "ya no escribe en el registro de la empresa").toBe(0);
    expect(await prismaAdmin.user.count(), "no crea ningún User").toBe(0);
  });

  it("sin cambios de valor no deja ninguna fila", async () => {
    await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR);
    const r = await cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR);
    expect(r.cambiadas).toEqual([]);
    expect(await auditoria()).toHaveLength(2);
  });

  it("es atómico con el cambio: si falla la segunda fila de auditoría, la política vuelve a como estaba", async () => {
    const db = conFallaEn("auditoriaPlataforma", "create", 2);
    await expect(cambiarPoliticaDeEmpresa(db, { slug: "norte", perfil: "lite" }, AUTOR)).rejects.toThrow("falla de prueba");
    const empresa = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: NORTE }, select: { permisosEditables: true, dosPaneles: true } });
    expect(empresa, "el update de la política se revirtió").toEqual({ permisosEditables: true, dosPaneles: true });
    expect(await auditoria(), "la primera fila se revirtió con él").toEqual([]);
  });
});
