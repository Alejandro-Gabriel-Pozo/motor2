import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La lectura previa de la regla se envuelve en un espía que, por defecto, llama a la real: solo las pruebas «SOLO el índice frena» la sortean.
vi.mock("../../src/server/persistencia/caja/configuracion", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("../../src/server/persistencia/caja/configuracion")>();
  return { ...real, hayOtraCuentaActivaEnSucursal: vi.fn(real.hayOtraCuentaActivaEnSucursal) };
});

import { azarDelProceso } from "../../src/lib/azar";
import { desactivarCuentaDeCobroCasoDeUso, reactivarCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cambiar-estado-de-cuenta-de-cobro";
import { crearCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/crear-cuenta-de-cobro";
import { editarCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/editar-cuenta-de-cobro";
import { hayOtraCuentaActivaEnSucursal } from "../../src/server/persistencia/caja/configuracion";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Caja y cobro, etapa C3b: UNA SOLA cuenta de cobro ACTIVA por sucursal (decisión del dueño, 2026-11-16, Q-C3-6; docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md), contra Postgres real.
 * Cubre el caso de uso (crear, editar la sucursal, reactivar, desactivar, con carreras de verdad) y la BASE directo con SQL crudo y el rol real de la app (`motor2_app`).
 * MUTACIÓN que debe dejar esto en ROJO: quitar el índice (`DROP INDEX "CuentaDeCobro_una_activa_por_sucursal_key"`) deja en rojo «rechaza la segunda activa (23505 del índice exacto)…» (verificado el 2026-11-16: 1 de 11 en rojo; al restituirlo, 11 de 11
 * en verde). Las carreras del caso de uso NO se ponen en rojo con esa mutación: las arbitra la transacción SERIALIZABLE con la lectura previa (el índice es el respaldo y su choque se traduce al mismo código); por eso la barrera se mide en la prueba de la base.
 * CADA CAPA POR SEPARADO (2026-11-17, verificado con mutación rojo/verde): (a) la lectura previa del caso de uso sola (se borra el índice dentro de la prueba y se restituye SIEMPRE en `finally`/`afterAll`; los archivos de vitest corren en serie, `fileParallelism: false`);
 * (b) el índice solo (la lectura previa se sortea con un espía sobre `hayOtraCuentaActivaEnSucursal` y el 23505 se traduce al mismo rechazo). Mutación (a): hacer que `hayOtraCuentaActivaEnSucursal` devuelva siempre `false` deja en rojo SOLO (a) (1 de 14); mutación (b): desactivar la traducción
 * del choque en `crearCuentaDeCobroCasoDeUso` deja en rojo SOLO (b) (1 de 14). Riesgo: si el proceso muere con el índice borrado, la base de pruebas queda sin él hasta la siguiente corrida de este archivo (su `beforeAll` lo restituye) o hasta `prisma migrate deploy` en una base nueva.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const CODIGO = "SUCURSAL_YA_TIENE_CUENTA_ACTIVA";
const abiertas: Client[] = [];

const base = (escritura: string[]) => baseDeEmpresa(EMPRESA, { lectura: escritura, escritura });
const actor = (escritura: string[] = [s.sucursalId]) => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, empresaZonaHoraria: "America/Argentina/Buenos_Aires", ...base(escritura) });
const crear = (nombre: string, sucursalId = s.sucursalId, tipo = "TERMINAL", escritura?: string[]) =>
  crearCuentaDeCobroCasoDeUso(actor(escritura), { tipo, nombre, identificadorExterno: null, sucursalId }, azarDelProceso);
const idDe = (r: Awaited<ReturnType<typeof crear>>) => {
  if (!r.ok) throw new Error(`no creó: ${r.mensaje}`);
  return r.datos.cuentaDeCobroId;
};
const activas = (sucursalId: string) => prismaAdmin.cuentaDeCobro.count({ where: { sucursalId, activa: true } });

afterEach(async () => {
  const cerrar = abiertas.splice(0);
  await Promise.all(cerrar.map(async (c) => { await c.query("ROLLBACK").catch(() => undefined); await c.end().catch(() => undefined); }));
});
afterAll(async () => {
  await prismaAdmin.$disconnect();
});
beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

async function otraSucursal() {
  return prismaAdmin.sucursal.create({ data: { nombre: "Norte" } });
}

describe("una sola cuenta activa por sucursal: los casos de uso", () => {
  it("crear una segunda ACTIVA en la misma sucursal es un rechazo de regla (no un error de la base) y no escribe ni audita", async () => {
    idDe(await crear("Posnet 1"));
    const auditoriasAntes = await prismaAdmin.registroAuditoria.count();
    expect(await crear("Posnet 2")).toMatchObject({ ok: false, codigo: CODIGO });
    expect(await crear("QR del salon", s.sucursalId, "QR")).toMatchObject({ ok: false, codigo: CODIGO });
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoriasAntes);
  });

  it("repetir la MISMA alta (mismo nombre, tipo, identificador y sucursal) sigue devolviendo la misma cuenta, no el rechazo", async () => {
    const id = idDe(await crear("Posnet 1"));
    expect(await crear("Posnet 1")).toMatchObject({ ok: true, datos: { cuentaDeCobroId: id, yaExistia: true } });
    expect(await activas(s.sucursalId)).toBe(1);
  });

  it("desactivar la activa y crear otra funciona; la desactivada queda y el historial no se borra", async () => {
    const a = idDe(await crear("Posnet 1"));
    expect(await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: a })).toMatchObject({ ok: true, datos: { yaEstabaInactiva: false } });
    const b = idDe(await crear("Posnet 2"));
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ activa: false });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ activa: true });
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(2);
  });

  it("en OTRA sucursal sí puede haber otra activa", async () => {
    const norte = await otraSucursal();
    idDe(await crear("Posnet 1"));
    idDe(await crear("Posnet Norte", norte.id, "TERMINAL", [s.sucursalId, norte.id]));
    expect(await activas(s.sucursalId)).toBe(1);
    expect(await activas(norte.id)).toBe(1);
  });

  it("reactivar una cuenta cuando hay OTRA activa en la sucursal es un rechazo y no cambia nada (ni versión ni auditoría)", async () => {
    const a = idDe(await crear("Posnet 1"));
    await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: a });
    idDe(await crear("Posnet 2"));
    const antes = await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: a } });
    const auditoriasAntes = await prismaAdmin.registroAuditoria.count();
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: a })).toMatchObject({ ok: false, codigo: CODIGO });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: a } })).toEqual(antes);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoriasAntes);
    // Reactivar la que YA es la activa sigue siendo «ya estaba activa» (por estado), no un rechazo.
    const activa = (await prismaAdmin.cuentaDeCobro.findFirstOrThrow({ where: { activa: true } })).id;
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: activa })).toMatchObject({ ok: true, datos: { yaEstabaActiva: true } });
  });

  it("la edición que pasa una cuenta ACTIVA a una sucursal que ya tiene otra activa se rechaza; una INACTIVA sí se puede pasar; mismo sitio y otros campos siguen andando", async () => {
    const norte = await otraSucursal();
    const ambas = [s.sucursalId, norte.id];
    const a = idDe(await crear("Posnet 1"));
    const n = idDe(await crear("Posnet Norte", norte.id, "TERMINAL", ambas));
    expect(await editarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a, versionEsperada: 1, nombre: "Posnet 1", identificadorExterno: null, sucursalId: norte.id })).toMatchObject({ ok: false, codigo: CODIGO });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ sucursalId: s.sucursalId, version: 1 });
    // Otros campos en el mismo sitio: no choca con nada.
    expect(await editarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a, versionEsperada: 1, nombre: "Posnet Salón", identificadorExterno: "T-1", sucursalId: s.sucursalId })).toMatchObject({ ok: true, datos: { version: 2 } });
    // Una inactiva no cuenta: se la puede pasar a la sucursal con otra activa.
    await desactivarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a });
    expect(await editarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a, versionEsperada: 3, nombre: "Posnet Salón", identificadorExterno: "T-1", sucursalId: norte.id })).toMatchObject({ ok: true });
    // …pero reactivarla ahí, con la de Norte activa, es el rechazo; y al revés, liberando Norte primero, sí.
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a })).toMatchObject({ ok: false, codigo: CODIGO });
    await desactivarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: n });
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a })).toMatchObject({ ok: true, datos: { yaEstabaActiva: false } });
    expect(await activas(norte.id)).toBe(1);
  });

  it("ocho altas a la vez en la misma sucursal (nombres distintos) dejan UNA activa; las otras siete son el rechazo de regla, ninguna sale como error", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => crear(`Posnet ${i + 1}`)));
    expect(rs.every((x) => x.status === "fulfilled")).toBe(true);
    const valores = rs.map((x) => (x.status === "fulfilled" ? x.value : null));
    expect(valores.filter((r) => r?.ok)).toHaveLength(1);
    expect(valores.filter((r) => r && !r.ok && r.codigo === CODIGO)).toHaveLength(7);
    expect(await activas(s.sucursalId)).toBe(1);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });

  it("ocho altas IGUALES a la vez dejan una sola cuenta: una crea y las demás ven que ya existía (por estado)", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => crear("Posnet 1")));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });

  it("reactivar a la vez dos cuentas inactivas de la misma sucursal: una gana y la otra es el rechazo de regla", async () => {
    const a = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "TERMINAL", nombre: "Vieja 1", activa: false } });
    const b = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "QR", nombre: "Vieja 2", activa: false } });
    const rs = await Promise.allSettled([a.id, b.id].map((cuentaDeCobroId) => reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId })));
    expect(rs.every((x) => x.status === "fulfilled")).toBe(true);
    const valores = rs.map((x) => (x.status === "fulfilled" ? x.value : null));
    expect(valores.filter((r) => r?.ok)).toHaveLength(1);
    expect(valores.filter((r) => r && !r.ok && r.codigo === CODIGO)).toHaveLength(1);
    expect(await activas(s.sucursalId)).toBe(1);
  });
});

const INDICE = "CuentaDeCobro_una_activa_por_sucursal_key";
// Misma definición que la migración 20261117118100_caja_c3b_una_cuenta_por_sucursal.
const CREAR_INDICE = `CREATE UNIQUE INDEX IF NOT EXISTS "${INDICE}" ON "CuentaDeCobro"("empresaId", "sucursalId") WHERE "activa"`;

/** Corre `fn` sin el índice (lo borra con el dueño) y lo restituye SIEMPRE, con la misma definición. Los archivos de vitest corren en serie (`fileParallelism: false`): nadie más usa la base mientras tanto. */
async function sinElIndice<T>(fn: () => Promise<T>): Promise<T> {
  await prismaAdmin.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDICE}"`);
  try {
    return await fn();
  } finally {
    await limpiarCuentas();
    await prismaAdmin.$executeRawUnsafe(CREAR_INDICE);
  }
}
const limpiarCuentas = () => prismaAdmin.$executeRawUnsafe(`DELETE FROM "CuentaDeCobro"`).catch(() => undefined);
const hayIndice = async () => (await prismaAdmin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = ${INDICE}`)[0]?.n === 1;

describe("cada capa frena por separado: la lectura previa del caso de uso y el índice de la base", () => {
  // Si una corrida anterior se cortó con el índice borrado, se restituye antes de empezar.
  beforeAll(async () => {
    await prismaAdmin.$executeRawUnsafe(CREAR_INDICE);
  });
  afterAll(async () => {
    await prismaAdmin.$executeRawUnsafe(CREAR_INDICE);
  });

  it("(a) SOLO la verificación del caso de uso frena: sin el índice, crear y reactivar una segunda activa dan el rechazo de regla", async () => {
    await sinElIndice(async () => {
      expect(await hayIndice()).toBe(false);
      const a = idDe(await crear("Posnet 1"));
      expect(await crear("Posnet 2")).toMatchObject({ ok: false, codigo: CODIGO });
      const vieja = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "QR", nombre: "Vieja", activa: false } });
      expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: vieja.id })).toMatchObject({ ok: false, codigo: CODIGO });
      expect(await activas(s.sucursalId)).toBe(1);
      expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: a } })).activa).toBe(true);
    });
    expect(await hayIndice(), "el índice quedó restituido").toBe(true);
  });

  it("(b) SOLO el índice frena: con la lectura previa sorteada, el choque 23505 se traduce al MISMO rechazo (crear, reactivar y editar la sucursal), sin error crudo", async () => {
    const real = (await vi.importActual<typeof import("../../src/server/persistencia/caja/configuracion")>("../../src/server/persistencia/caja/configuracion")).hayOtraCuentaActivaEnSucursal;
    const norte = await otraSucursal();
    const ambas = [s.sucursalId, norte.id];
    vi.mocked(hayOtraCuentaActivaEnSucursal).mockResolvedValue(false);
    try {
      expect(await hayIndice()).toBe(true);
      const a = idDe(await crear("Posnet 1"));
      const n = idDe(await crear("Posnet Norte", norte.id, "TERMINAL", ambas));
      const vieja = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "QR", nombre: "Vieja", activa: false } });
      expect(await crear("Posnet 2")).toMatchObject({ ok: false, codigo: CODIGO });
      expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: vieja.id })).toMatchObject({ ok: false, codigo: CODIGO });
      expect(await editarCuentaDeCobroCasoDeUso(actor(ambas), { cuentaDeCobroId: a, versionEsperada: 1, nombre: "Posnet 1", identificadorExterno: null, sucursalId: norte.id })).toMatchObject({ ok: false, codigo: CODIGO });
      expect(vi.mocked(hayOtraCuentaActivaEnSucursal)).toHaveBeenCalled();
      expect(await activas(s.sucursalId)).toBe(1);
      expect(await activas(norte.id)).toBe(1);
      expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: n } })).activa).toBe(true);
    } finally {
      vi.mocked(hayOtraCuentaActivaEnSucursal).mockImplementation(real);
    }
  });

  it("(b') un choque de unicidad que NO es el de la regla (el nombre) no se disfraza: con otro tipo, el nombre repetido sigue siendo CUENTA_DUPLICADA", async () => {
    idDe(await crear("Posnet 1"));
    expect(await crear("POSNET 1", s.sucursalId, "QR")).toMatchObject({ ok: false, codigo: "CUENTA_DUPLICADA" });
  });
});

describe("una sola cuenta activa por sucursal: la BASE, directo con SQL crudo y el rol de la app", () => {
  async function comoApp(): Promise<Client> {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    abiertas.push(c);
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', $2, true), set_config('app.sucursales_escritura', $2, true)", [EMPRESA, s.sucursalId]);
    return c;
  }
  async function falla(c: Client, texto: string, params: unknown[] = []): Promise<{ code?: string; constraint?: string } | null> {
    await c.query("SAVEPOINT intento");
    try {
      await c.query(texto, params);
      await c.query("RELEASE SAVEPOINT intento");
      return null;
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT intento");
      return e as { code?: string; constraint?: string };
    }
  }
  const insertar = (activa: boolean, nombre: string): [string, unknown[]] => [`INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre","activa") VALUES ($1,$2,'TERMINAL',$3,$4)`, [randomUUID(), s.sucursalId, nombre, activa]];

  it("rechaza la segunda activa (23505 del índice exacto) y acepta las inactivas extra", async () => {
    const c = await comoApp();
    expect(await falla(c, ...insertar(true, "Activa 1"))).toBeNull();
    const choque = await falla(c, ...insertar(true, "Activa 2"));
    expect(choque).toMatchObject({ code: "23505", constraint: "CuentaDeCobro_una_activa_por_sucursal_key" });
    expect(await falla(c, ...insertar(false, "Inactiva 1"))).toBeNull();
    expect(await falla(c, ...insertar(false, "Inactiva 2"))).toBeNull();
    // Activar una inactiva con otra activa también choca contra el mismo índice.
    expect(await falla(c, `UPDATE "CuentaDeCobro" SET "activa" = true WHERE "nombre" = 'Inactiva 1'`)).toMatchObject({ code: "23505", constraint: "CuentaDeCobro_una_activa_por_sucursal_key" });
    // Desactivar la activa libera el lugar.
    expect(await falla(c, `UPDATE "CuentaDeCobro" SET "activa" = false WHERE "nombre" = 'Activa 1'`)).toBeNull();
    expect(await falla(c, `UPDATE "CuentaDeCobro" SET "activa" = true WHERE "nombre" = 'Inactiva 1'`)).toBeNull();
  });

  it("en otra sucursal de la misma empresa sí admite otra activa (el índice es por empresa y sucursal)", async () => {
    const norte = await otraSucursal();
    const c = await comoApp();
    await c.query("SELECT set_config('app.sucursales_lectura', $1, true), set_config('app.sucursales_escritura', $1, true)", [`${s.sucursalId},${norte.id}`]);
    expect(await falla(c, ...insertar(true, "Activa Salón"))).toBeNull();
    expect(await falla(c, `INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ($1,$2,'QR','Activa Norte')`, [randomUUID(), norte.id])).toBeNull();
  });
});
