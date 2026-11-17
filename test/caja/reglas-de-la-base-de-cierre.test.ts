import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { pesosDeCentavos } from "./oraculo-de-diferencia";

/**
 * Las reglas de la BASE del cierre del día (C2) y de la foto congelada (C2b), ejercidas DIRECTO con SQL crudo y con el rol real de la app (`motor2_app`, sujeto a la RLS), SIN pasar por los casos de uso. Dos cosas que ninguna otra prueba protegía:
 *
 * (1) CENTAVOS: la `diferencia` es una columna GENERADA (`ConciliacionDeJornada` y `ConciliacionDeCobroPorOrigen`) y tiene que ser EXACTA al centavo. Todos los importes de las otras pruebas son múltiplos de $1: un redondeo al peso pasaba. Acá, 300 casos aleatorios
 *     de centavos contra el oráculo (`oraculo-de-diferencia.ts`), cada uno dentro de un SAVEPOINT. MUTACIÓN que deja esto en ROJO (psql como dueño, en la base de prueba): `ALTER TABLE "ConciliacionDeJornada" DROP COLUMN "diferencia"; ALTER TABLE "ConciliacionDeJornada" ADD COLUMN
 *     "diferencia" DECIMAL(14,2) GENERATED ALWAYS AS (CASE WHEN "estadoDeConteo" IN ('CONTADO','DECLARADO') THEN round("declarado" - ("registrado" + "correcciones"), 0) END) STORED;` (y lo mismo con `round("cobrado" - "totalDelTicket", 0)` en `ConciliacionDeCobroPorOrigen`);
 *     se restituye con la expresión original de la migración 20261117116000.
 *
 * (2) ÚNICOS: una prueba por cada índice único de jornada o de clave de reintento de las tablas de C2 y C2b. La segunda fila repite SOLO lo que ese índice cubre (lo demás es válido y distinto) y tiene que fallar con 23505 del índice EXACTO (se compara el nombre
 *     de la restricción, no solo el código). Sin estas pruebas se podía borrar cualquiera de los once índices y nada se ponía rojo. MUTACIÓN por índice (psql como dueño): `DROP INDEX "<nombre>";` deja en ROJO su prueba (la segunda fila entra o falla con otro error);
 *     se restituye con el `CREATE UNIQUE INDEX` de su migración (20261117114000_caja_c2_jornada o 20261117116000_caja_c2b_conciliacion).
 *     Índices: JornadaDeSucursal_una_por_dia_key, ControlDeJornadaCerrada_empresaId_jornadaId_clave_key, CorreccionDeMedio_empresaId_cobroId_secuencia_key, CorreccionDeMedio_empresaId_claveIdempotencia_key, DeclaracionDeTotal_empresaId_jornadaId_medioDePagoId_secuencia_key,
 *     DeclaracionDeTotal_empresaId_claveIdempotencia_key, ConformeDeJornada_empresaId_jornadaId_key, ConformeDeJornada_empresaId_claveIdempotencia_key, CierreDeCajaDeJornada_empresaId_jornadaId_key, ConciliacionDeJornada_empresaId_cierreId_medioDePagoId_key,
 *     ConciliacionDeCobroPorOrigen_empresaId_cierreId_cobranzaId_key. Los dos de «secuencia» (corrección y declaración) los tapa un disparador (`CorreccionDeMedio_validar`, `DeclaracionDeTotal_validar`: la secuencia sigue sin huecos) en el camino normal: el índice es
 *     la barrera contra dos transacciones concurrentes que leen la misma última secuencia. Para ejercerlo SOLO a él, esas dos pruebas apagan el disparador en una transacción propia (como dueño) y pasan a `motor2_app` con `SET LOCAL ROLE`; el apagado se deshace con el ROLLBACK.
 *     Postgres corta los nombres a 63 caracteres: el de `DeclaracionDeTotal_…_secuencia_key` queda `DeclaracionDeTotal_empresaId_jornadaId_medioDePagoId_secuencia_` (es el que se compara y el que se borra en la mutación).
 *     Los índices `<tabla>_empresaId_id_key` son destino de claves foráneas compuestas: quitarlos rompe la migración, no hace falta una prueba aparte.
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

const GUC = "SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', $2, true), set_config('app.sucursales_escritura', $2, true)";

/** Una conexión como `motor2_app` con la empresa y el alcance de la sucursal fijados, dentro de una transacción abierta. */
async function comoApp(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  abiertas.push(c);
  await c.query("BEGIN");
  await c.query(GUC, [EMPRESA, s.sucursalId]);
  return c;
}

/** Como `comoApp`, pero con UN disparador apagado (lo hace el dueño dentro de la transacción y se deshace con el ROLLBACK); después las sentencias corren como `motor2_app`, con su RLS y sus privilegios. */
async function comoAppSinDisparador(tabla: string, disparador: string): Promise<Client> {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  abiertas.push(c);
  await c.query("BEGIN");
  await c.query(`ALTER TABLE "${tabla}" DISABLE TRIGGER "${disparador}"`);
  await c.query("SET LOCAL ROLE motor2_app");
  await c.query(GUC, [EMPRESA, s.sucursalId]);
  return c;
}

interface Fallo { code: string; constraint: string | undefined; message: string }

/** El error con el que falla una sentencia (dentro de un SAVEPOINT que se deshace si falla), o `null` si anduvo. */
async function falla(c: Client, texto: string, params: unknown[] = []): Promise<Fallo | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(texto, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    const x = e as { code?: string; constraint?: string; message: string };
    return { code: x.code ?? "sin código", constraint: x.constraint, message: x.message };
  }
}

/** La sentencia tiene que entrar. */
async function entra(c: Client, texto: string, params: unknown[] = []): Promise<void> {
  expect(await falla(c, texto, params)).toBeNull();
}

/** La sentencia falla con 23505 DEL ÍNDICE indicado y con ningún otro error. */
async function fallaPorUnico(c: Client, indice: string, texto: string, params: unknown[] = []): Promise<void> {
  const f = await falla(c, texto, params);
  expect(f, `la segunda fila tenía que fallar (índice ${indice})`).not.toBeNull();
  // Postgres corta los identificadores a 63 caracteres: el nombre que informa es el cortado.
  expect({ code: f?.code, constraint: f?.constraint }, f?.message).toEqual({ code: "23505", constraint: indice.slice(0, 63) });
}

interface Armado { caja: string; efectivo: string; tarjeta: string; jornada: string; sesion: string }

/** Caja, medios (efectivo y tarjeta), la jornada ABIERTA del 15/01 y una sesión de ese día. */
async function armar(c: Client): Promise<Armado> {
  const caja = randomUUID(); const efectivo = randomUUID(); const tarjeta = randomUUID(); const jornada = randomUUID(); const sesion = randomUUID();
  await c.query(`INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ($1,$2,'Caja 1')`, [caja, s.sucursalId]);
  await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [efectivo]);
  await c.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'TARJETA_DEBITO')`, [tarjeta]);
  await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,'2026-01-15')`, [jornada, s.sucursalId]);
  await c.query(
    `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","abiertaEn","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','2026-01-15T15:00:00Z','America/Argentina/Buenos_Aires',$4,$5,$6)`,
    [sesion, s.sucursalId, caja, s.admin.id, randomUUID(), HUELLA],
  );
  return { caja, efectivo, tarjeta, jornada, sesion };
}

let numeroDeMesa = 100;
/** Una cuenta cerrada (con el dueño: el fixture de ventas no es lo que se prueba acá). */
async function cuentaCerrada(): Promise<string> {
  const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: numeroDeMesa++ } });
  return (await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA, mesaId: mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(Date.now() - 86_400_000), cerradaPorId: s.admin.id } })).id;
}

/** Un cobro de $100 en efectivo de la sesión (cobranza + movimiento + renglón), con la jornada todavía ABIERTA. */
async function cobrar(c: Client, a: Armado): Promise<{ cobranza: string; cobro: string }> {
  const cuenta = await cuentaCerrada();
  const cobranza = randomUUID(); const mov = randomUUID(); const cobro = randomUUID();
  await c.query(`INSERT INTO "Cobranza" ("id","sucursalId","cuentaId","sesionId","total","claveIdempotencia","huella","creadoPorId") VALUES ($1,$2,$3,$4,100.00,$5,$6,$7)`, [cobranza, s.sucursalId, cuenta, a.sesion, randomUUID(), HUELLA, s.admin.id]);
  await c.query(`INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","creadoPorId") VALUES ($1,$2,$3,'COBRO',$4,100.00,$5)`, [mov, s.sucursalId, a.sesion, a.efectivo, s.admin.id]);
  await c.query(`INSERT INTO "Cobro" ("id","sucursalId","cobranzaId","orden","medioDePagoId","movimientoId","importe") VALUES ($1,$2,$3,1,$4,$5,100.00)`, [cobro, s.sucursalId, cobranza, a.efectivo, mov]);
  return { cobranza, cobro };
}

const enAuditoria = (c: Client, jornada: string) =>
  c.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'EN_AUDITORIA', "auditoriaIniciadaEn" = now(), "auditoriaIniciadaPorId" = $2 WHERE "id" = $1`, [jornada, s.admin.id]);
/** Pasa a CERRADA en ESTA transacción (lo que exigen los disparadores de la foto: estado CERRADA y `xmin` de la transacción en curso). */
const cerrar = (c: Client, jornada: string) =>
  c.query(`UPDATE "JornadaDeSucursal" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2, "huellaDeCierre" = $3 WHERE "id" = $1`, [jornada, s.admin.id, HUELLA]);

/** Otra jornada (otro día) ya EN_AUDITORIA. */
async function otraJornadaEnAuditoria(c: Client, fecha: string): Promise<string> {
  const id = randomUUID();
  await c.query(`INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,$3)`, [id, s.sucursalId, fecha]);
  await enAuditoria(c, id);
  return id;
}

const SQL = {
  jornada: `INSERT INTO "JornadaDeSucursal" ("id","sucursalId","fechaDeNegocio") VALUES ($1,$2,$3)`,
  control: `INSERT INTO "ControlDeJornadaCerrada" ("id","sucursalId","jornadaId","modulo","clave","severidad","cantidad","reconocido") VALUES ($1,$2,$3,'caja','caja.un_control','INFORMA',0,false)`,
  correccion: `INSERT INTO "CorreccionDeMedio" ("id","sucursalId","jornadaId","cobroId","secuencia","medioAntesId","medioDespuesId","motivo","corregidoEn","corregidoPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,$4,$5,$6,$7,'Se cargo en el medio equivocado',now(),$8,$9,$10)`,
  declaracion: `INSERT INTO "DeclaracionDeTotal" ("id","sucursalId","jornadaId","medioDePagoId","secuencia","importe","declaradoEn","declaradoPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,$4,$5,100.00,now(),$6,$7,$8)`,
  conforme: `INSERT INTO "ConformeDeJornada" ("id","sucursalId","jornadaId","conformePorId","conformeEn","claveIdempotencia","huella") VALUES ($1,$2,$3,$4,now(),$5,$6)`,
  cierre: `INSERT INTO "CierreDeCajaDeJornada" ("id","sucursalId","jornadaId","congeladoEn","congeladoPorId") VALUES ($1,$2,$3,now(),$4)`,
  linea: `INSERT INTO "ConciliacionDeJornada" ("id","sucursalId","cierreId","medioDePagoId","registrado","correcciones","declarado","estadoDeConteo") VALUES ($1,$2,$3,$4,0,0,NULL,'SIN_DATO')`,
  origen: `INSERT INTO "ConciliacionDeCobroPorOrigen" ("id","sucursalId","cierreId","cobranzaId","cobrado","totalDelTicket") VALUES ($1,$2,$3,$4,100.00,90.00)`,
};

describe("diferencia generada: exacta al centavo (columna GENERATED de C2b)", () => {
  /** La jornada del día cerrada en la transacción y su cabecera de la foto. */
  async function cabecera(c: Client, a: Armado): Promise<{ cierre: string; cobranza: string }> {
    const { cobranza } = await cobrar(c, a);
    await enAuditoria(c, a.jornada);
    await cerrar(c, a.jornada);
    const cierre = randomUUID();
    await c.query(SQL.cierre, [cierre, s.sucursalId, a.jornada, s.admin.id]);
    return { cierre, cobranza };
  }

  it("ConciliacionDeJornada.diferencia = declarado − (registrado + correcciones) al centavo, y es NULA sin total (300 casos)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const { cierre } = await cabecera(c, a);
    const insertar = `INSERT INTO "ConciliacionDeJornada" ("id","sucursalId","cierreId","medioDePagoId","registrado","correcciones","declarado","estadoDeConteo") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "diferencia"::text AS d`;
    const importe = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }).map((n) => BigInt(n));
    let conCentavos = 0;
    await fc.assert(
      fc.asyncProperty(importe, importe, fc.integer({ min: 0, max: 1_000_000_000_000 }).map((n) => BigInt(n)), async (registrado, correcciones, declarado) => {
        await c.query("SAVEPOINT caso");
        const r = await c.query(insertar, [randomUUID(), s.sucursalId, cierre, a.tarjeta, pesosDeCentavos(registrado), pesosDeCentavos(correcciones), pesosDeCentavos(declarado), "DECLARADO"]);
        const esperada = declarado - (registrado + correcciones);
        if (esperada % BigInt(100) !== BigInt(0)) conCentavos += 1;
        expect(r.rows[0].d).toBe(pesosDeCentavos(esperada));
        await c.query("ROLLBACK TO SAVEPOINT caso");
      }),
      { numRuns: 300 },
    );
    expect(conCentavos).toBeGreaterThan(200);
    // Con SIN_DATO (o CONFORME) no hay total: la diferencia es nula, no cero.
    const sin = await c.query(`INSERT INTO "ConciliacionDeJornada" ("id","sucursalId","cierreId","medioDePagoId","registrado","correcciones","declarado","estadoDeConteo") VALUES ($1,$2,$3,$4,1234.56,-0.07,NULL,'SIN_DATO') RETURNING "diferencia" AS d`, [randomUUID(), s.sucursalId, cierre, a.tarjeta]);
    expect(sin.rows[0].d).toBeNull();
    await c.query("ROLLBACK");
  });

  it("ConciliacionDeCobroPorOrigen.diferencia = cobrado − total del ticket al centavo (300 casos)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const { cierre, cobranza } = await cabecera(c, a);
    const insertar = `INSERT INTO "ConciliacionDeCobroPorOrigen" ("id","sucursalId","cierreId","cobranzaId","cobrado","totalDelTicket") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "diferencia"::text AS d`;
    const importe = fc.integer({ min: 0, max: 1_000_000_000_000 }).map((n) => BigInt(n));
    let conCentavos = 0;
    await fc.assert(
      fc.asyncProperty(importe, importe, async (cobrado, total) => {
        fc.pre(cobrado !== total); // la base solo guarda los que difieren (CHECK ConciliacionDeCobroPorOrigen_difiere_chk)
        await c.query("SAVEPOINT caso");
        const r = await c.query(insertar, [randomUUID(), s.sucursalId, cierre, cobranza, pesosDeCentavos(cobrado), pesosDeCentavos(total)]);
        if ((cobrado - total) % BigInt(100) !== BigInt(0)) conCentavos += 1;
        expect(r.rows[0].d).toBe(pesosDeCentavos(cobrado - total));
        await c.query("ROLLBACK TO SAVEPOINT caso");
      }),
      { numRuns: 300 },
    );
    expect(conCentavos).toBeGreaterThan(200);
    await c.query("ROLLBACK");
  });
});

describe("únicos de jornada y de clave de reintento (C2 y C2b): 23505 del índice exacto", () => {
  it("JornadaDeSucursal_una_por_dia_key: dos jornadas de la misma sucursal y el mismo día", async () => {
    const c = await comoApp();
    await armar(c); // ya trae la del 15/01
    await fallaPorUnico(c, "JornadaDeSucursal_una_por_dia_key", SQL.jornada, [randomUUID(), s.sucursalId, "2026-01-15"]);
    await entra(c, SQL.jornada, [randomUUID(), s.sucursalId, "2026-01-16"]); // contracara: otro día entra
    await c.query("ROLLBACK");
  });

  it("ControlDeJornadaCerrada_empresaId_jornadaId_clave_key: el mismo control dos veces en la misma jornada", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    await cerrar(c, a.jornada);
    await entra(c, SQL.control, [randomUUID(), s.sucursalId, a.jornada]);
    await fallaPorUnico(c, "ControlDeJornadaCerrada_empresaId_jornadaId_clave_key", SQL.control, [randomUUID(), s.sucursalId, a.jornada]);
    await c.query("ROLLBACK");
  });

  it("CorreccionDeMedio_empresaId_cobroId_secuencia_key: dos correcciones del mismo cobro con la misma secuencia (la barrera ante dos transacciones concurrentes; el disparador de secuencia apagado)", async () => {
    const c = await comoAppSinDisparador("CorreccionDeMedio", "CorreccionDeMedio_validar");
    const a = await armar(c);
    const { cobro } = await cobrar(c, a);
    await enAuditoria(c, a.jornada);
    await entra(c, SQL.correccion, [randomUUID(), s.sucursalId, a.jornada, cobro, 1, a.efectivo, a.tarjeta, s.admin.id, randomUUID(), HUELLA]);
    // Misma secuencia, otra clave de reintento: lo único repetido es (cobro, secuencia).
    await fallaPorUnico(c, "CorreccionDeMedio_empresaId_cobroId_secuencia_key", SQL.correccion, [randomUUID(), s.sucursalId, a.jornada, cobro, 1, a.efectivo, a.tarjeta, s.admin.id, randomUUID(), HUELLA]);
    await c.query("ROLLBACK");
  });

  it("CorreccionDeMedio_empresaId_claveIdempotencia_key: la misma clave de reintento en otra corrección (secuencia 2 válida, para que no salte el de secuencia)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const { cobro } = await cobrar(c, a);
    await enAuditoria(c, a.jornada);
    const clave = randomUUID();
    await entra(c, SQL.correccion, [randomUUID(), s.sucursalId, a.jornada, cobro, 1, a.efectivo, a.tarjeta, s.admin.id, clave, HUELLA]);
    // Secuencia 2 desde el medio vigente (tarjeta → efectivo): cumple el disparador; solo repite la clave.
    await fallaPorUnico(c, "CorreccionDeMedio_empresaId_claveIdempotencia_key", SQL.correccion, [randomUUID(), s.sucursalId, a.jornada, cobro, 2, a.tarjeta, a.efectivo, s.admin.id, clave, HUELLA]);
    await c.query("ROLLBACK");
  });

  it("DeclaracionDeTotal_empresaId_jornadaId_medioDePagoId_secuencia_key: dos declaraciones del mismo medio con la misma secuencia (barrera ante concurrencia; disparador apagado)", async () => {
    const c = await comoAppSinDisparador("DeclaracionDeTotal", "DeclaracionDeTotal_validar");
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    await entra(c, SQL.declaracion, [randomUUID(), s.sucursalId, a.jornada, a.tarjeta, 1, s.admin.id, randomUUID(), HUELLA]);
    await fallaPorUnico(c, "DeclaracionDeTotal_empresaId_jornadaId_medioDePagoId_secuencia_key", SQL.declaracion, [randomUUID(), s.sucursalId, a.jornada, a.tarjeta, 1, s.admin.id, randomUUID(), HUELLA]);
    await c.query("ROLLBACK");
  });

  it("DeclaracionDeTotal_empresaId_claveIdempotencia_key: la misma clave de reintento en otra declaración (secuencia 2 válida)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    const clave = randomUUID();
    await entra(c, SQL.declaracion, [randomUUID(), s.sucursalId, a.jornada, a.tarjeta, 1, s.admin.id, clave, HUELLA]);
    await fallaPorUnico(c, "DeclaracionDeTotal_empresaId_claveIdempotencia_key", SQL.declaracion, [randomUUID(), s.sucursalId, a.jornada, a.tarjeta, 2, s.admin.id, clave, HUELLA]);
    await c.query("ROLLBACK");
  });

  it("ConformeDeJornada_empresaId_jornadaId_key: dos conformes generales de la misma jornada (con claves de reintento distintas)", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    await entra(c, SQL.conforme, [randomUUID(), s.sucursalId, a.jornada, s.admin.id, randomUUID(), HUELLA]);
    await fallaPorUnico(c, "ConformeDeJornada_empresaId_jornadaId_key", SQL.conforme, [randomUUID(), s.sucursalId, a.jornada, s.admin.id, randomUUID(), HUELLA]);
    await c.query("ROLLBACK");
  });

  it("ConformeDeJornada_empresaId_claveIdempotencia_key: la misma clave de reintento en el conforme de OTRA jornada", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    const otra = await otraJornadaEnAuditoria(c, "2026-01-16");
    const clave = randomUUID();
    await entra(c, SQL.conforme, [randomUUID(), s.sucursalId, a.jornada, s.admin.id, clave, HUELLA]);
    // Otra jornada: lo único repetido es la clave (no el único por jornada).
    await fallaPorUnico(c, "ConformeDeJornada_empresaId_claveIdempotencia_key", SQL.conforme, [randomUUID(), s.sucursalId, otra, s.admin.id, clave, HUELLA]);
    await c.query("ROLLBACK");
  });

  it("CierreDeCajaDeJornada_empresaId_jornadaId_key: dos fotos de la misma jornada", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    await cerrar(c, a.jornada);
    await c.query(SQL.cierre, [randomUUID(), s.sucursalId, a.jornada, s.admin.id]);
    await fallaPorUnico(c, "CierreDeCajaDeJornada_empresaId_jornadaId_key", SQL.cierre, [randomUUID(), s.sucursalId, a.jornada, s.admin.id]);
    await c.query("ROLLBACK");
  });

  it("ConciliacionDeJornada_empresaId_cierreId_medioDePagoId_key: dos líneas del mismo medio en la misma foto", async () => {
    const c = await comoApp();
    const a = await armar(c);
    await enAuditoria(c, a.jornada);
    await cerrar(c, a.jornada);
    const cierre = randomUUID();
    await c.query(SQL.cierre, [cierre, s.sucursalId, a.jornada, s.admin.id]);
    await entra(c, SQL.linea, [randomUUID(), s.sucursalId, cierre, a.tarjeta]);
    await fallaPorUnico(c, "ConciliacionDeJornada_empresaId_cierreId_medioDePagoId_key", SQL.linea, [randomUUID(), s.sucursalId, cierre, a.tarjeta]);
    await c.query("ROLLBACK");
  });

  it("ConciliacionDeCobroPorOrigen_empresaId_cierreId_cobranzaId_key: dos orígenes de la misma cobranza en la misma foto", async () => {
    const c = await comoApp();
    const a = await armar(c);
    const { cobranza } = await cobrar(c, a);
    await enAuditoria(c, a.jornada);
    await cerrar(c, a.jornada);
    const cierre = randomUUID();
    await c.query(SQL.cierre, [cierre, s.sucursalId, a.jornada, s.admin.id]);
    await entra(c, SQL.origen, [randomUUID(), s.sucursalId, cierre, cobranza]);
    await fallaPorUnico(c, "ConciliacionDeCobroPorOrigen_empresaId_cierreId_cobranzaId_key", SQL.origen, [randomUUID(), s.sucursalId, cierre, cobranza]);
    await c.query("ROLLBACK");
  });
});
