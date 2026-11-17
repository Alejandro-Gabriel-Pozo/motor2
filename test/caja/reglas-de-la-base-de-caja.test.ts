import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Las reglas de la BASE de la caja, ejercidas DIRECTO con SQL crudo y con el rol real de la app (`motor2_app`, sujeto a la RLS), SIN pasar por los casos de uso: el dinero no puede depender solo de que el código se acuerde.
 * Una prueba de violación por regla (índice, CHECK o disparador) y su contracara (lo válido pasa). Mutaciones que deben dejar esto en ROJO: quitar el índice `SesionCaja_una_sin_cerrar_por_caja_key`; cambiar la lista de denominaciones
 * del CHECK `ArqueoBillete_denominacion_chk`; quitar el disparador `SesionCaja_verificar_cierre`; quitar cualquiera de los demás CHECK, índices o disparadores de la migración 20261117110000_caja_c1.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const abiertas: Client[] = [];
const HUELLA = "a".repeat(64);
const DENOMINACIONES_VALIDAS = [10, 20, 50, 100, 200, 500, 1000, 2000, 10000, 20000];

// Pase lo que pase en una prueba, ninguna transacción queda abierta (una abierta retiene bloqueos y traba la limpieza de la siguiente).
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
});

/** Una conexión como `motor2_app` con la empresa y el alcance de la sucursal fijados, dentro de una transacción abierta. */
async function comoApp(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  abiertas.push(c);
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', $2, true), set_config('app.sucursales_escritura', $2, true)", [EMPRESA, s.sucursalId]);
  return c;
}

/** El SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT que se deshace si falla), o `null` si anduvo. */
async function falla(c: Client, texto: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string }).code ?? "sin código";
  }
}

/** El mensaje de la sentencia que falla (para distinguir los disparadores que comparten SQLSTATE). */
async function mensaje(c: Client, texto: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return "";
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as Error).message;
  }
}

interface Armado { caja: string; efectivo: string; sesion: string }

/** Deja en la transacción una caja, el efectivo y una sesión ABIERTA (todo con el rol de la app). */
async function armar(c: Client): Promise<Armado> {
  const caja = randomUUID();
  const efectivo = randomUUID();
  const sesion = randomUUID();
  await c.query(`INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ($1,$2,'Caja 1')`, [caja, s.sucursalId]);
  await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [efectivo]);
  // C2: toda sesión cuelga de la jornada ABIERTA de su sucursal y fecha de negocio (la caja abre una sola vez por día de negocio).
  await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-15')`, [randomUUID(), s.sucursalId]);
  await c.query(
    `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','2026-01-15T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`,
    [sesion, s.sucursalId, caja, s.admin.id, randomUUID(), HUELLA],
  );
  return { caja, efectivo, sesion };
}

const movimiento = (a: Armado, clase: string, importe: string, extra: { motivo?: string | null; anulaA?: string | null; clave?: string | null; medio?: string } = {}) => ({
  texto: `INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","motivo","anulaAId","claveIdempotencia","creadoPorId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  params: [randomUUID(), s.sucursalId, a.sesion, clase, extra.medio ?? a.efectivo, importe, extra.motivo ?? null, extra.anulaA ?? null, extra.clave ?? null, s.admin.id],
});
const insertar = (c: Client, m: { texto: string; params: unknown[] }) => falla(c, m.texto, m.params);

describe("sesión: una sola sin cerrar por caja y el ciclo ABIERTA → CERRADA", () => {
  it("un segundo INSERT de sesión abierta para la misma caja es 23505 (índice SesionCaja_una_sin_cerrar_por_caja_key)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-16')`, [randomUUID(), s.sucursalId]);
    const otra = `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','2026-01-15T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`;
    expect(await falla(c, otra, [randomUUID(), s.sucursalId, a.caja, s.admin.id, randomUUID(), HUELLA])).toBe("23505");
    await c.query("ROLLBACK");
  });

  it("la sesión solo pasa de ABIERTA a CERRADA y la cerrada no se toca", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await mensaje(c, `UPDATE "SesionCaja" SET "observacion" = 'x' WHERE "id" = $1`, [a.sesion])).toMatch(/SesionCaja_marcas_chk|sesion_caja/);
    await c.query("ROLLBACK");
  });
});

describe("arqueo: denominaciones permitidas (CHECK ArqueoBillete_denominacion_chk)", () => {
  it("una denominación inexistente (5, 15, 30000) es 23514", async () => {
    const c = await comoApp();
    const a = await armar(c);
    for (const den of [5, 15, 30000, 0]) {
      expect(await falla(c, `INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,$4,1)`, [randomUUID(), s.sucursalId, a.sesion, den]), `denominación ${den}`).toBe("23514");
    }
    await c.query("ROLLBACK");
  });

  it("cada una de las 10 denominaciones válidas pasa", async () => {
    const c = await comoApp();
    const a = await armar(c);
    for (const den of DENOMINACIONES_VALIDAS) {
      expect(await falla(c, `INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,$4,1)`, [randomUUID(), s.sucursalId, a.sesion, den]), `denominación ${den}`).toBeNull();
    }
    expect((await c.query(`SELECT count(*)::int AS n FROM "ArqueoBillete"`)).rows[0].n).toBe(10);
    await c.query("ROLLBACK");
  });

  it("la cantidad es de 0 a 99999 y no se repite una denominación en la sesión", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const q = `INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,$4,$5)`;
    expect(await falla(c, q, [randomUUID(), s.sucursalId, a.sesion, 100, -1])).toBe("23514");
    expect(await falla(c, q, [randomUUID(), s.sucursalId, a.sesion, 100, 100000])).toBe("23514");
    expect(await falla(c, q, [randomUUID(), s.sucursalId, a.sesion, 100, 0])).toBeNull();
    expect(await falla(c, q, [randomUUID(), s.sucursalId, a.sesion, 100, 1])).toBe("23505");
    await c.query("ROLLBACK");
  });
});

describe("cierre: el arqueo tiene que cuadrar con lo movido, todo o nada (disparador diferido SesionCaja_verificar_cierre)", () => {
  const cerrar = (c: Client, a: Armado) => c.query(`UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]);

  it("cerrar una sesión sin ningún arqueo falla AL COMMIT y la sesión sigue ABIERTA", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"))).toBeNull();
    await cerrar(c, a);
    await expect(c.query("COMMIT")).rejects.toThrow(/cierre_arqueo_no_cuadra_con_los_movimientos/);
    // Lo que quedó (la transacción entera se deshizo, incluido el armado): nada.
    expect(await prismaAdmin.sesionCaja.count({ where: { id: a.sesion } })).toBe(0);
  });

  it("cerrar con un arqueo cuyo esperado no es el movido falla al COMMIT", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"));
    await c.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,99.00,100.00,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await c.query(`INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,100,1)`, [randomUUID(), s.sucursalId, a.sesion]);
    await cerrar(c, a);
    await expect(c.query("COMMIT")).rejects.toThrow(/cierre_arqueo_no_cuadra_con_los_movimientos/);
  });

  it("cerrar con billetes y monedas que no dan lo contado falla al COMMIT", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"));
    await c.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,100.00,100.00,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await c.query(`INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,200,1)`, [randomUUID(), s.sucursalId, a.sesion]);
    await cerrar(c, a);
    await expect(c.query("COMMIT")).rejects.toThrow(/cierre_billetes_y_monedas_no_dan_lo_contado/);
  });

  it("cerrar con el efectivo dado por «conforme» (sin contar) falla al COMMIT", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"));
    await c.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","conforme") VALUES ($1,$2,$3,$4,100.00,true)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await cerrar(c, a);
    await expect(c.query("COMMIT")).rejects.toThrow(/cierre_sin_efectivo_contado/);
  });

  it("cerrar con un arqueo que cuadra (esperado movido, billetes + monedas = contado) PASA y deja la sesión CERRADA", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"));
    await c.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","contadoMonedas","conforme") VALUES ($1,$2,$3,$4,100.00,100.50,0.50,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await c.query(`INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,100,1)`, [randomUUID(), s.sucursalId, a.sesion]);
    await cerrar(c, a);
    await c.query("COMMIT");
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.sesion } })).estado).toBe("CERRADA");
  });
});

describe("movimientos: signo por clase, motivo, espejo exacto y una sola vez (CHECK, índices y disparador)", () => {
  it("el signo de cada clase lo exige la base: una prueba de violación por clase y su contracara", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "0.00"))).toBeNull(); // el fondo admite cero
    expect(await insertar(c, movimiento(a, "COBRO", "0.00"))).toBe("23514");
    expect(await insertar(c, movimiento(a, "COBRO", "-1.00"))).toBe("23514");
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "0.00", { motivo: "x" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "-1.00", { motivo: "x" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "EGRESO_MANUAL", "1.00", { motivo: "x" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "EGRESO_MANUAL", "0.00", { motivo: "x" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "1.00", { motivo: "x" }))).toBeNull();
    expect(await insertar(c, movimiento(a, "EGRESO_MANUAL", "-1.00", { motivo: "x" }))).toBeNull();
    await c.query("ROLLBACK");
  });

  it("el fondo no puede ser negativo y es uno solo por sesión (23514 y 23505)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "-1.00"))).toBe("23514");
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "10.00"))).toBeNull();
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "20.00"))).toBe("23505");
    await c.query("ROLLBACK");
  });

  it("el motivo es obligatorio en los manuales y no va en el fondo ni en el cobro; la clase es de una lista cerrada", async () => {
    const c = await comoApp();
    const a = await armar(c);
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "1.00"))).toBe("23514");
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "1.00", { motivo: "" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "FONDO_INICIAL", "1.00", { motivo: "x" }))).toBe("23514");
    expect(await insertar(c, movimiento(a, "AJUSTE", "1.00", { motivo: "x" }))).toBe("23514");
    await c.query("ROLLBACK");
  });

  it("un movimiento manual solo en efectivo y un cobro solo con el medio activo", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const tarjeta = randomUUID();
    await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'TARJETA_DEBITO')`, [tarjeta]);
    expect(await mensaje(c, ...(Object.values(movimiento(a, "INGRESO_MANUAL", "1.00", { motivo: "x", medio: tarjeta })) as [string, unknown[]]))).toMatch(/movimiento_manual_solo_en_efectivo/);
    const inactivo = randomUUID();
    await c.query(`INSERT INTO "MedioDePago" ("id","tipo","activo") VALUES ($1,'QR',false)`, [inactivo]);
    expect(await mensaje(c, ...(Object.values(movimiento(a, "COBRO", "1.00", { medio: inactivo })) as [string, unknown[]]))).toMatch(/cobro_con_medio_inactivo/);
    await c.query("ROLLBACK");
  });

  it("una anulación es el espejo exacto, de un manual, en la misma sesión y una sola vez", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const original = movimiento(a, "EGRESO_MANUAL", "-5.00", { motivo: "x" });
    expect(await insertar(c, original)).toBeNull();
    const id = original.params[0] as string;
    const anular = (importe: string, motivo: string | null = "me equivoqué", anulaA: string | null = id) => movimiento(a, "ANULACION", importe, { motivo, anulaA });
    expect(await mensaje(c, ...(Object.values(anular("4.00")) as [string, unknown[]]))).toMatch(/anulacion_no_es_el_espejo/);
    expect(await mensaje(c, ...(Object.values(anular("-5.00")) as [string, unknown[]]))).toMatch(/anulacion_no_es_el_espejo/);
    expect(await insertar(c, anular("5.00", null))).toBe("23514");
    expect(await insertar(c, anular("5.00", "x", null))).toBe("23514");
    expect(await insertar(c, anular("5.00"))).toBeNull();
    expect(await insertar(c, anular("5.00"))).toBe("23505");
    await c.query("ROLLBACK");
  });

  it("un cobro no se anula (23514) y la clave de reintento no se repite en la empresa (23505)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const cobro = movimiento(a, "COBRO", "10.00");
    expect(await insertar(c, cobro)).toBeNull();
    expect(await mensaje(c, ...(Object.values(movimiento(a, "ANULACION", "-10.00", { motivo: "x", anulaA: cobro.params[0] as string })) as [string, unknown[]]))).toMatch(/anulacion_de_movimiento_no_anulable/);
    const clave = randomUUID();
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "1.00", { motivo: "x", clave }))).toBeNull();
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "2.00", { motivo: "y", clave }))).toBe("23505");
    expect(await insertar(c, movimiento(a, "INGRESO_MANUAL", "2.00", { motivo: "y", clave: "no-es-un-uuid" }))).toBe("23514");
    await c.query("ROLLBACK");
  });

  it("no se mueve plata en una sesión de otra sucursal ni cerrada, y la app no borra", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await c.query("ROLLBACK");
    const d = await comoApp();
    const b = await armar(d);
    await d.query(`SELECT set_config('app.sucursales_escritura', $1, true)`, [s.sucursalId]);
    expect(await falla(d, `DELETE FROM "MovimientoCaja"`)).toBe("42501");
    expect(await falla(d, `DELETE FROM "SesionCaja"`)).toBe("42501");
    expect(await falla(d, `UPDATE "MovimientoCaja" SET "motivo" = 'x'`)).toBe("42501");
    expect(b.sesion).not.toBe(a.sesion);
    await d.query("ROLLBACK");
  });
});

describe("cobro: una sola cobranza por cuenta y la suma de los renglones es el total (disparador diferido Cobranza_cuadra)", () => {
  async function cuentaCerrada(): Promise<string> {
    const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 70 } });
    const cuenta = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA, mesaId: mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(Date.now() - 86_400_000), cerradaPorId: s.admin.id } });
    return cuenta.id;
  }
  const cobranza = (a: Armado, cuenta: string, total: string, clave = randomUUID()) => ({
    id: randomUUID(),
    texto: `INSERT INTO "Cobranza" ("id","sucursalId","cuentaId","sesionId","total","claveIdempotencia","huella","creadoPorId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    params: (id: string) => [id, s.sucursalId, cuenta, a.sesion, total, clave, HUELLA, s.admin.id],
  });

  it("una cobranza sin renglones, o con renglones que no suman el total, falla AL COMMIT", async () => {
    const cuenta = await cuentaCerrada();
    const c = await comoApp();
    const a = await armar(c);
    const cb = cobranza(a, cuenta, "100.00");
    await c.query(cb.texto, cb.params(cb.id));
    await expect(c.query("COMMIT")).rejects.toThrow(/cobranza_no_cuadra/);
  });

  it("con los renglones que suman el total PASA; la misma cuenta no se cobra dos veces (23505) y el total es mayor que cero", async () => {
    const cuenta = await cuentaCerrada();
    const c = await comoApp();
    const a = await armar(c);
    const cb = cobranza(a, cuenta, "100.00");
    await c.query(cb.texto, cb.params(cb.id));
    const mov = movimiento(a, "COBRO", "100.00");
    await c.query(mov.texto, mov.params);
    await c.query(`INSERT INTO "Cobro" ("id","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe") VALUES ($1,$2,$3,1,$4,$5,100.00)`, [randomUUID(), s.sucursalId, cb.id, a.efectivo, mov.params[0]]);
    const otra = cobranza(a, cuenta, "100.00");
    expect(await falla(c, otra.texto, otra.params(otra.id))).toBe("23505");
    const cero = cobranza(a, cuenta, "0.00");
    expect(await falla(c, cero.texto, cero.params(cero.id))).not.toBeNull();
    await c.query("COMMIT");
    expect(await prismaAdmin.cobranza.count()).toBe(1);
  });

  it("no se cobra una cuenta abierta (23514) y un renglón tiene que ser su movimiento (importe, medio y clase)", async () => {
    const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 71 } });
    const abierta = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA, mesaId: mesa.id, abiertaPorId: s.admin.id } });
    const c = await comoApp();
    const a = await armar(c);
    const cb = cobranza(a, abierta.id, "100.00");
    expect(await mensaje(c, cb.texto, cb.params(cb.id))).toMatch(/cobranza_de_cuenta_abierta/);
    const cuenta = await cuentaCerrada();
    const ok = cobranza(a, cuenta, "100.00");
    await c.query(ok.texto, ok.params(ok.id));
    const mov = movimiento(a, "COBRO", "90.00");
    await c.query(mov.texto, mov.params);
    expect(await mensaje(c, `INSERT INTO "Cobro" ("id","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe") VALUES ($1,$2,$3,1,$4,$5,100.00)`, [randomUUID(), s.sucursalId, ok.id, a.efectivo, mov.params[0]])).toMatch(/cobro_no_es_su_movimiento/);
    expect(await falla(c, `INSERT INTO "Cobro" ("id","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe") VALUES ($1,$2,$3,51,$4,$5,90.00)`, [randomUUID(), s.sucursalId, ok.id, a.efectivo, mov.params[0]])).toBe("23514");
    await c.query("ROLLBACK");
  });
});

describe("medios de pago: tipo cerrado, un efectivo por empresa que no se desactiva", () => {
  it("las reglas del medio de pago, directo en la base", async () => {
    const c = await comoApp();
    expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'CHEQUE')`, [randomUUID()])).toBe("23514");
    expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [randomUUID()])).toBeNull();
    expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [randomUUID()])).toBe("23505");
    expect(await falla(c, `UPDATE "MedioDePago" SET "activo" = false WHERE "tipo" = 'EFECTIVO'`)).toBe("23514");
    expect(await falla(c, `UPDATE "MedioDePago" SET "tipo" = 'QR'`)).toBe("42501");
    expect(await falla(c, `INSERT INTO "MedioDePago" ("id","tipo","nombre") VALUES ($1,'QR','<script>')`, [randomUUID()])).toBe("23514");
    await c.query("ROLLBACK");
  });

  it("la caja: una por sucursal (23505) y la app no puede cambiarla ni borrarla", async () => {
    const c = await comoApp();
    await armar(c);
    expect(await falla(c, `INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ($1,$2,'Caja 2')`, [randomUUID(), s.sucursalId])).toBe("23505");
    expect(await falla(c, `UPDATE "Caja" SET "nombre" = 'otra'`)).toBe("42501");
    expect(await falla(c, `DELETE FROM "Caja"`)).toBe("42501");
    await c.query("ROLLBACK");
  });
});

describe("claves de reintento únicas y renglones agregados desde otra transacción (reglas que antes solo protegía el código)", () => {
  async function cuentaCerradaEn(numeroDeMesa: number): Promise<string> {
    const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: numeroDeMesa } });
    const cuenta = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA, mesaId: mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(Date.now() - 86_400_000), cerradaPorId: s.admin.id } });
    return cuenta.id;
  }
  const cobranzaSql = `INSERT INTO "Cobranza" ("id","sucursalId","cuentaId","sesionId","total","claveIdempotencia","huella","creadoPorId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  const cobroSql = `INSERT INTO "Cobro" ("id","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe") VALUES ($1,$2,$3,$4,$5,$6,$7)`;

  it("la clave de reintento de una sesión no se repite en la empresa (23505, SesionCaja_empresaId_claveIdempotencia_key), aunque la primera ya esté cerrada", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const clave = (await c.query(`SELECT "claveIdempotencia" FROM "SesionCaja" WHERE "id" = $1`, [a.sesion])).rows[0].claveIdempotencia as string;
    // Se cierra la primera (con su fondo y un arqueo que cuadra) para que NO salte el índice de «una sin cerrar por caja»: la única barrera que queda es la de la clave.
    await insertar(c, movimiento(a, "FONDO_INICIAL", "100.00"));
    await c.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,100.00,100.00,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await c.query(`INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,100,1)`, [randomUUID(), s.sucursalId, a.sesion]);
    await c.query(`UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]);
    await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-16')`, [randomUUID(), s.sucursalId]);
    const otra = `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-16','2026-01-16T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`;
    // La primera está CERRADA: el único motivo posible del 23505 es la clave repetida (no el índice de «una sin cerrar por caja»).
    expect(await falla(c, otra, [randomUUID(), s.sucursalId, a.caja, s.admin.id, clave, HUELLA])).toBe("23505");
    await c.query("ROLLBACK");
  });

  it("la clave de reintento de una cobranza no se repite en la empresa, aunque sea de OTRA cuenta (23505, Cobranza_empresaId_claveIdempotencia_key)", async () => {
    const [cuentaA, cuentaB] = [await cuentaCerradaEn(80), await cuentaCerradaEn(81)];
    const c = await comoApp();
    const a = await armar(c);
    const clave = randomUUID();
    expect(await falla(c, cobranzaSql, [randomUUID(), s.sucursalId, cuentaA, a.sesion, "100.00", clave, HUELLA, s.admin.id])).toBeNull();
    // Otra cuenta (sin cobranza todavía) con la MISMA clave: el único motivo posible del 23505 es la clave repetida (no el único por cuenta).
    expect(await falla(c, cobranzaSql, [randomUUID(), s.sucursalId, cuentaB, a.sesion, "100.00", clave, HUELLA, s.admin.id])).toBe("23505");
    await c.query("ROLLBACK");
  });

  it("un renglón agregado DESPUÉS, en otra transacción, a una cobranza ya confirmada rompe la suma y falla al COMMIT (disparador Cobro_cuadra)", async () => {
    const cuenta = await cuentaCerradaEn(82);
    const primera = await comoApp();
    const a = await armar(primera);
    const cobranzaId = randomUUID();
    const mov1 = movimiento(a, "COBRO", "100.00");
    await primera.query(cobranzaSql, [cobranzaId, s.sucursalId, cuenta, a.sesion, "100.00", randomUUID(), HUELLA, s.admin.id]);
    await primera.query(mov1.texto, mov1.params);
    await primera.query(cobroSql, [randomUUID(), s.sucursalId, cobranzaId, 1, a.efectivo, mov1.params[0], "100.00"]);
    await primera.query("COMMIT");
    expect(await prismaAdmin.cobro.count()).toBe(1);

    const segunda = await comoApp();
    const mov2 = movimiento(a, "COBRO", "50.00");
    await segunda.query(mov2.texto, mov2.params);
    await segunda.query(cobroSql, [randomUUID(), s.sucursalId, cobranzaId, 2, a.efectivo, mov2.params[0], "50.00"]);
    await expect(segunda.query("COMMIT")).rejects.toThrow(/cobranza_no_cuadra/);
    expect(await prismaAdmin.cobro.count(), "el renglón de la segunda transacción no quedó").toBe(1);
  });
});
