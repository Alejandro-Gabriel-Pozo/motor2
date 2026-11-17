import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Convivencia de C3 y C2 sobre la MISMA función de la base (`MovimientoCaja_validar`): C2 la reemplazó partiendo de la de C3, y un reemplazo mal fusionado dejaría una de las dos reglas apagada sin que ninguna prueba propia lo note.
 * Con las dos migraciones aplicadas tienen que seguir activas, con el rol real de la app y SQL crudo: (C3) un movimiento con cuenta de cobro la valida contra el medio y la anulación es espejo también en la cuenta;
 * (C2) sin jornada abierta no entra plata y un ajuste solo corrige una jornada que existe y está CERRADA.
 * Mutaciones que deben dejar esto en ROJO: sacar de la función de C2 el `ELSE PERFORM "CuentaDeCobro_validar_par"…`, la comparación `cuentaDeCobroId IS DISTINCT FROM` de la anulación o el chequeo de jornada abierta; o volver a pegar la función de C1.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const abiertas: Client[] = [];
const HUELLA = "a".repeat(64);

afterEach(async () => {
  const cerrar = abiertas.splice(0);
  await Promise.all(cerrar.map(async (c) => { await c.query("ROLLBACK").catch(() => undefined); await c.end().catch(() => undefined); }));
});
afterAll(async () => { await prismaAdmin.$disconnect(); });
beforeEach(async () => { await limpiarBaseDeTest(); s = await sembrarSalon(); });

async function comoApp(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  abiertas.push(c);
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', $2, true), set_config('app.sucursales_escritura', $2, true)", [EMPRESA, s.sucursalId]);
  return c;
}

async function mensaje(c: Client, texto: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT intento");
  try { await c.query(texto, params); await c.query("RELEASE SAVEPOINT intento"); return ""; } catch (e) { await c.query("ROLLBACK TO SAVEPOINT intento"); return (e as Error).message; }
}

interface Armado { sesion: string; efectivo: string; tarjeta: string; cuenta: string }

/** Caja, medios (efectivo y tarjeta), una cuenta de cobro, la jornada ABIERTA del 15/01 y una sesión de ese día. */
async function armar(c: Client): Promise<Armado> {
  const caja = randomUUID(); const efectivo = randomUUID(); const tarjeta = randomUUID(); const cuenta = randomUUID(); const sesion = randomUUID();
  await c.query(`INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ($1,$2,'Caja 1')`, [caja, s.sucursalId]);
  await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [efectivo]);
  await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'TARJETA_DEBITO')`, [tarjeta]);
  await c.query(`INSERT INTO "CuentaDeCobro" ("id","sucursalId","tipo","nombre") VALUES ($1,$2,'TERMINAL','Posnet 1')`, [cuenta, s.sucursalId]);
  await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-15')`, [randomUUID(), s.sucursalId]);
  await c.query(
    `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','2026-01-15T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`,
    [sesion, s.sucursalId, caja, s.admin.id, randomUUID(), HUELLA],
  );
  return { sesion, efectivo, tarjeta, cuenta };
}

const mov = (a: Armado, clase: string, medio: string, importe: string, extra: { cuenta?: string | null; anulaA?: string | null; corrige?: string | null; motivo?: string | null } = {}) => ({
  id: randomUUID(),
  texto: `INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","motivo","anulaAId","cuentaDeCobroId","corrigeJornada","creadoPorId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  params: (id: string) => [id, s.sucursalId, a.sesion, clase, medio, importe, extra.motivo ?? null, extra.anulaA ?? null, extra.cuenta ?? null, extra.corrige ?? null, s.admin.id],
});
const meter = (c: Client, m: ReturnType<typeof mov>) => mensaje(c, m.texto, m.params(m.id));

describe("C3 y C2 aplicadas juntas: las reglas de las dos siguen activas en MovimientoCaja_validar", () => {
  it("(C3) la cuenta de cobro se valida contra el medio: el efectivo no lleva cuenta; la tarjeta con una cuenta compatible pasa", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await meter(c, mov(a, "COBRO", a.efectivo, "100.00", { cuenta: a.cuenta }))).toMatch(/movimiento_caja_cuenta_no_admitida/);
    expect(await meter(c, mov(a, "COBRO", a.tarjeta, "100.00", { cuenta: a.cuenta }))).toBe("");
  });

  it("(C3) la anulación de un ajuste o manual es espejo también en la cuenta de cobro, y (C2) un AJUSTE se anula con espejo exacto", async () => {
    const c = await comoApp();
    const a = await armar(c);
    // Un AJUSTE se acepta solo contra una jornada cerrada: acá no hay ninguna, así que se prueba la anulación sobre un ingreso manual en efectivo (sin cuenta) y con una cuenta de más (no es el espejo).
    const ingreso = mov(a, "INGRESO_MANUAL", a.efectivo, "50.00", { motivo: "ingreso" });
    expect(await meter(c, ingreso)).toBe("");
    expect(await meter(c, mov(a, "ANULACION", a.efectivo, "-50.00", { anulaA: ingreso.id, cuenta: a.cuenta, motivo: "error" }))).toMatch(/cuenta_no_admitida|no_es_el_espejo/);
    expect(await meter(c, mov(a, "ANULACION", a.efectivo, "-50.00", { anulaA: ingreso.id, motivo: "error" }))).toBe("");
  });

  it("(C2) sin jornada no hay sesión: una sesión de un día sin jornada se rechaza (sesion_caja_jornada_no_abierta) y con ella entra", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const caja = (await c.query(`SELECT "id" FROM "Caja" LIMIT 1`)).rows[0].id as string;
    const sesion20 = `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-20','2026-01-20T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`;
    expect(await mensaje(c, sesion20, [randomUUID(), s.sucursalId, caja, s.admin.id, randomUUID(), HUELLA])).toMatch(/sesion_caja_jornada_no_abierta/);
    await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-20')`, [randomUUID(), s.sucursalId]);
    // Con la jornada ya no falla por jornada: el único rechazo que queda es «una sesión sin cerrar por caja» (la del 15/01 sigue abierta).
    expect(await mensaje(c, sesion20, [randomUUID(), s.sucursalId, caja, s.admin.id, randomUUID(), HUELLA])).toMatch(/SesionCaja_una_sin_cerrar_por_caja_key/);
    expect(a.sesion).toBeTruthy();
  });

  it("(C2) un AJUSTE corrige solo una jornada que existe y está CERRADA y es anterior: inexistente y abierta se rechazan", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await meter(c, mov(a, "AJUSTE", a.efectivo, "10.00", { corrige: "2026-01-10", motivo: "ajuste" }))).toMatch(/ajuste_corrige_jornada_inexistente/);
    await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-14')`, [randomUUID(), s.sucursalId]);
    expect(await meter(c, mov(a, "AJUSTE", a.efectivo, "10.00", { corrige: "2026-01-14", motivo: "ajuste" }))).toMatch(/ajuste_corrige_jornada_no_cerrada/);
  });
});
