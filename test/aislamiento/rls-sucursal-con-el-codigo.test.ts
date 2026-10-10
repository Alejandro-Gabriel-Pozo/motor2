import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPRESA_A, EMPRESA_B, SUC, crearMundoDeSucursales, sqlBueno, type MundoDeSucursales } from "./rls-sucursal-mundo";

/**
 * M.3, Fase A, paso A10, con el CÓDIGO REAL de la app: `dbDeEmpresa`, `transaccionDeEmpresa` y `baseDeEmpresa` (`src/core/auth/base.ts`, paso A2) contra la base temporal que tiene las políticas del generador (paso A9).
 * `rls-sucursal.test.ts` prueba lo que las políticas HACEN con las variables fijadas a mano; acá se prueba que lo que el código FIJA es lo que las políticas LEEN (el formato de las listas, el `true` local a la
 * transacción, el reparto del pool) y se miran las formas que llegan a Prisma: `P2025` en un UPDATE/DELETE cruzado, el rechazo de un INSERT cruzado, el `include` hacia un padre invisible y la clave de idempotencia.
 *
 * Cómo llega el código real a la base temporal: `src/lib/db.ts` toma `DATABASE_URL` al importarse, así que antes de importar `base.ts` se apunta esa variable a la base temporal (con las credenciales del rol
 * `motor2_app`) y se descarta el cliente global; al terminar se restaura todo. Este archivo no toca ninguna otra base.
 */
type Base = typeof import("../../src/core/auth/base");
type Cliente = import("@prisma/client").PrismaClient;

let mundo: MundoDeSucursales;
let base: Base;
let prisma: Cliente;
const previo = { url: process.env.DATABASE_URL, cliente: (globalThis as { prisma?: unknown }).prisma };

beforeAll(async () => {
  mundo = await crearMundoDeSucursales();
  if (!mundo.hayRol) return;
  await mundo.aplicar(sqlBueno());
  process.env.DATABASE_URL = mundo.urlComoApp();
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  base = await import("../../src/core/auth/base");
  prisma = (await import("../../src/lib/db")).prisma;
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  if (previo.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previo.url;
  if (previo.cliente === undefined) delete (globalThis as { prisma?: unknown }).prisma;
  else (globalThis as { prisma?: unknown }).prisma = previo.cliente;
  await mundo?.cerrar();
});

const alcanceA1 = { lectura: [SUC.a1], escritura: [SUC.a1] };

describe("la app real (base.ts) contra las políticas del generador", () => {
  it("la conexión es a la base temporal y como motor2_app (si no, nada de lo de abajo prueba lo que dice)", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const r = await prisma.$queryRaw<{ base: string; rol: string }[]>`SELECT current_database() AS base, current_user AS rol`;
    expect(r[0].rol).toBe("motor2_app");
    expect(r[0].base).toMatch(/_paridad_\d+$/);
  });

  it("dbDeEmpresa con alcance en A1: lee solo A1, un UPDATE/DELETE cruzado es P2025 y un INSERT cruzado lo rechaza la base", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const db = base.dbDeEmpresa(EMPRESA_A, alcanceA1);
    expect((await db.seccion.findMany({ select: { id: true } })).map((s) => s.id)).toEqual(["secA1"]);
    expect(await db.seccion.findUnique({ where: { id: "secA2" } })).toBeNull();
    expect(await db.seccion.count()).toBe(1);
    await expect(db.seccion.update({ where: { id: "secA2" }, data: { nombre: "otro" } })).rejects.toMatchObject({ code: "P2025" });
    await expect(db.seccion.delete({ where: { id: "secA2" } })).rejects.toMatchObject({ code: "P2025" });
    expect((await db.seccion.updateMany({ where: { id: "secA2" }, data: { nombre: "otro" } })).count).toBe(0);
    const rechazo = await db.seccion.create({ data: { id: "ajena", nombre: "ajena", sucursalId: SUC.a2 } }).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string; cause?: { originalCode?: string } },
    );
    expect(rechazo, "el INSERT cruzado tiene que fallar").not.toBeNull();
    expect(JSON.stringify([rechazo?.code, rechazo?.message, rechazo?.cause]), "el rechazo es el de la RLS (42501), no otro").toMatch(/42501|row-level security/);
    // La propia sí se escribe (y se deshace con una transacción que falla a propósito).
    const sentinela = new Error("deshacer");
    await expect(
      base.transaccionDeEmpresa(
        EMPRESA_A,
        async (tx) => {
          await tx.seccion.create({ data: { id: "propia", nombre: "propia", sucursalId: SUC.a1 } });
          expect((await tx.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id)).toEqual(["propia", "secA1"]);
          throw sentinela;
        },
        undefined,
        alcanceA1,
      ),
    ).rejects.toBe(sentinela);
  });

  it("los include recorren la cadena de padres visibles, y hacia un padre invisible devuelven null aunque el tipo diga que no puede (límite documentado de MovimientoStock)", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const db = base.dbDeEmpresa(EMPRESA_A, alcanceA1);
    const items = await db.cuentaItem.findMany({ include: { cuenta: { include: { mesa: true } } } });
    expect(items.map((i) => [i.id, i.cuenta.id, i.cuenta.mesa.id])).toEqual([["itemA1", "cuentaA1", "mesaA1"]]);
    // Un include de la sección (padre visible) anda.
    const conSeccion = await db.movimientoStock.findMany({ where: { id: "movA1" }, include: { seccion: true } });
    expect(conSeccion.map((m) => m.seccion.id)).toEqual(["secA1"]);
    // El movimiento «incoherente» (sección de A1, operación de A2) se ve, pero su operación no. OJO: el include de una relación OBLIGATORIA a un padre invisible NO tira un error: devuelve `operacion: null`
    // aunque el tipo diga que nunca es null, y el primer `.operacion.proceso` del código que lo use se cae en ejecución.
    // LIMITACIÓN: la política de MovimientoStock mira solo la FK a Sección. Hay que mantener los datos coherentes y que los casos de uso validen la sucursal de la operación (ADR de alcance por sucursal).
    const cruzado = await db.movimientoStock.findMany({ where: { id: "movCruzado" }, include: { operacion: true } });
    expect(cruzado.map((m) => [m.id, m.operacion])).toEqual([["movCruzado", null]]);
    // Un INNER JOIN en SQL, en cambio, hace desaparecer la fila (se prueba en rls-sucursal-mundo.ts, escenario E6).
  });

  it("sin alcance (dbDeEmpresa(empresa), como el login y elegir empresa) las tablas por sucursal no devuelven ni aceptan nada; GOBIERNO (Sucursal) sí se lee", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const db = base.dbDeEmpresa(EMPRESA_A);
    expect(await db.seccion.count()).toBe(0);
    expect(await db.registroAuditoria.count()).toBe(0);
    expect(await db.operacion.count()).toBe(0);
    await expect(db.seccion.create({ data: { id: "x", nombre: "x", sucursalId: SUC.a1 } })).rejects.toThrow();
    // Las sucursales de la empresa se leen sin alcance (clase GOBIERNO: el login y el gate las leen antes de saber la sucursal).
    expect((await db.sucursal.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id)).toEqual([SUC.a1, SUC.a2, SUC.a3]);
    // Una lista vacía explícita es lo mismo.
    const vacio = base.dbDeEmpresa(EMPRESA_A, { lectura: [], escritura: [] });
    expect(await vacio.seccion.count()).toBe(0);
  });

  it("baseDeEmpresa: db y transaccion usan el MISMO alcance, y el alcance no queda en la conexión al terminar la transacción", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const ctxApp = base.baseDeEmpresa(EMPRESA_A, { lectura: [SUC.a1, SUC.a2], escritura: [SUC.a2] });
    expect(ctxApp.alcance).toEqual({ lectura: [SUC.a1, SUC.a2], escritura: [SUC.a2] });
    expect((await ctxApp.db.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id)).toEqual(["secA1", "secA2"]);
    const enTx = await ctxApp.transaccion(async (tx) => (await tx.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id));
    expect(enTx).toEqual(["secA1", "secA2"]);
    // Después, una conexión cualquiera del pool (hay varias, y esta es la que acaba de terminar): sin transacción de empresa no ve las variables.
    for (let i = 0; i < 12; i++) {
      const r = await prisma.$queryRaw<{ l: string | null; e: string | null; emp: string | null }[]>`SELECT current_setting('app.sucursales_lectura', true) AS l, current_setting('app.sucursales_escritura', true) AS e, current_setting('app.empresa_id', true) AS emp`;
      expect([r[0].l ?? "", r[0].e ?? "", r[0].emp ?? ""], `iteración ${i}: el alcance se filtró a la conexión`).toEqual(["", "", ""]);
    }
  });

  it("(10) concurrencia: 60 transacciones simultáneas con alcances distintos en el mismo pool no se filtran entre sí", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const alcances = [
      { alcance: { lectura: [SUC.a1], escritura: [SUC.a1] }, esperado: ["secA1"] },
      { alcance: { lectura: [SUC.a2], escritura: [SUC.a2] }, esperado: ["secA2"] },
      { alcance: { lectura: [SUC.a1, SUC.a2], escritura: [] }, esperado: ["secA1", "secA2"] },
      { alcance: { lectura: [SUC.a3], escritura: [SUC.a3] }, esperado: [] },
      { alcance: undefined, esperado: [] },
    ];
    const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const trabajos = Array.from({ length: 60 }, (_, i) => alcances[i % alcances.length]).map(async ({ alcance, esperado }, i) => {
      await pausa((i * 7) % 23); // arrancan escalonadas para que se entrelacen
      return base.transaccionDeEmpresa(
        EMPRESA_A,
        async (tx) => {
          const antes = (await tx.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id);
          await tx.$executeRaw`SELECT pg_sleep(${0.005 + ((i * 3) % 7) / 1000})`; // mientras otras transacciones fijan y leen su propio alcance
          const despues = (await tx.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id);
          return { i, antes, despues, esperado };
        },
        undefined,
        alcance,
      );
    });
    const resultados = await Promise.all(trabajos);
    for (const r of resultados) {
      expect(r.antes, `transacción ${r.i} (antes de la pausa)`).toEqual(r.esperado);
      expect(r.despues, `transacción ${r.i} (después de la pausa)`).toEqual(r.esperado);
    }
    // Y una empresa distinta a la vez no se mezcla con ellas.
    const [a, b] = await Promise.all([
      base.dbDeEmpresa(EMPRESA_A, { lectura: [SUC.a1], escritura: [] }).seccion.findMany({ select: { id: true } }),
      base.dbDeEmpresa(EMPRESA_B, { lectura: [SUC.b1], escritura: [] }).seccion.findMany({ select: { id: true } }),
    ]);
    expect([a.map((s) => s.id), b.map((s) => s.id)]).toEqual([["secA1"], ["secB1"]]);
  });

  it("(11) I3: la misma clave de idempotencia no duplica en la misma sucursal; desde otra se ve como P2002 (la clave es única GLOBAL: límite documentado, no se arregla acá)", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const desdeA1 = base.dbDeEmpresa(EMPRESA_A, alcanceA1);
    const desdeA2 = base.dbDeEmpresa(EMPRESA_A, { lectura: [SUC.a2], escritura: [SUC.a2] });
    const datos = (sucursalId: string, id: string) => ({ id, sucursalId, proceso: "COMPRA" as const, fecha: new Date(), usuarioId: "u1", claveIdempotencia: "clave-A1" });
    // Lo que hace `chequearIdempotencia`: buscar por clave. En la sucursal dueña la ve (y el caso de uso devuelve el resultado ORIGINAL sin insertar); desde otra, la RLS la oculta.
    expect((await desdeA1.operacion.findUnique({ where: { claveIdempotencia: "clave-A1" }, select: { id: true } }))?.id).toBe("opA1");
    expect(await desdeA2.operacion.findUnique({ where: { claveIdempotencia: "clave-A1" }, select: { id: true } })).toBeNull();
    // Si igual se intentara insertar de nuevo, en la misma sucursal o en otra, el índice único (que no mira la RLS) lo frena: no hay filas duplicadas.
    await expect(desdeA1.operacion.create({ data: datos(SUC.a1, "dup1") })).rejects.toMatchObject({ code: "P2002" });
    await expect(desdeA2.operacion.create({ data: datos(SUC.a2, "dup2") })).rejects.toMatchObject({ code: "P2002" });
    expect(await mundo.base.cliente.query(`SELECT count(*)::int AS n FROM "Operacion" WHERE "claveIdempotencia" = 'clave-A1'`).then((r) => r.rows[0].n)).toBe(1);
  });
});
