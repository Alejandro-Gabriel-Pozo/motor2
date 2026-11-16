import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Las reglas de la BASE del estado EN_CIERRE de la caja (migración 20261117119000_caja_c1b_en_cierre), ejercidas DIRECTO con SQL crudo y con el rol real de la app (`motor2_app`, sujeto a la RLS), SIN pasar por los casos de uso.
 * Una violación por regla y su contracara. Mutaciones que deben dejar esto en ROJO: quitar `EN_CIERRE` del CHECK `SesionCaja_estado_chk`; quitar el CHECK `SesionCaja_marcas_chk`; reemplazar `SesionCaja_validar` por la de C1
 * (o quitarle la lista de transiciones); quitar el chequeo de ABIERTA en `MovimientoCaja_validar` o en `Cobranza_validar` (en `SesionCaja_exigir_abierta`); quitar el de EN_CIERRE en `Arqueo_validar` (`SesionCaja_exigir_en_cierre`).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const abiertas: Client[] = [];
const HUELLA = "a".repeat(64);

afterEach(async () => {
  const cerrar = abiertas.splice(0);
  await Promise.all(cerrar.map(async (x) => { await x.query("ROLLBACK").catch(() => undefined); await x.end().catch(() => undefined); }));
});
afterAll(async () => {
  await prismaAdmin.$disconnect();
});
beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
});

/** Una conexión como `motor2_app` con la empresa y el alcance fijados, dentro de una transacción abierta. */
async function comoApp(): Promise<Client> {
  const x = new Client({ connectionString: process.env.DATABASE_URL });
  await x.connect();
  abiertas.push(x);
  await x.query("BEGIN");
  await x.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_lectura', $2, true), set_config('app.sucursales_escritura', $2, true)", [EMPRESA, s.sucursalId]);
  return x;
}

/** El SQLSTATE y el mensaje con el que falla una sentencia (dentro de un SAVEPOINT que se deshace si falla), o `null` si anduvo. */
async function falla(x: Client, texto: string, params: unknown[] = []): Promise<{ code: string; message: string } | null> {
  await x.query("SAVEPOINT intento");
  try {
    await x.query(texto, params);
    await x.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await x.query("ROLLBACK TO SAVEPOINT intento");
    return { code: (e as { code?: string }).code ?? "sin código", message: (e as Error).message };
  }
}

interface Armado { caja: string; efectivo: string; sesion: string }

async function armar(x: Client): Promise<Armado> {
  const a = { caja: randomUUID(), efectivo: randomUUID(), sesion: randomUUID() };
  await x.query(`INSERT INTO "Caja" ("id","sucursalId","nombre") VALUES ($1,$2,'Caja 1')`, [a.caja, s.sucursalId]);
  await x.query(`INSERT INTO "MedioDePago" ("id","tipo") VALUES ($1,'EFECTIVO')`, [a.efectivo]);
  await x.query(
    `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','America/Argentina/Buenos_Aires',$4,$5,$6)`,
    [a.sesion, s.sucursalId, a.caja, s.admin.id, randomUUID(), HUELLA],
  );
  return a;
}

const iniciar = (x: Client, a: Armado) => x.query(`UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]);
const cerrarSql = `UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2 WHERE "id" = $1`;
const movimiento = async (x: Client, a: Armado, clase: string, importe: string) =>
  falla(x, `INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","motivo","creadoPorId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), s.sucursalId, a.sesion, clase, a.efectivo, importe, clase === "FONDO_INICIAL" || clase === "COBRO" ? null : "x", s.admin.id]);
const arqueo = (x: Client, a: Armado) => falla(x, `INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,0,0,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
const billete = (x: Client, a: Armado) => falla(x, `INSERT INTO "ArqueoBillete" ("id","sucursalId","sesionId","denominacion","cantidad") VALUES ($1,$2,$3,100,1)`, [randomUUID(), s.sucursalId, a.sesion]);

describe("transiciones de la sesión (disparador SesionCaja_validar)", () => {
  it("ABIERTA → EN_CIERRE pasa; ABIERTA → CERRADA directo, ABIERTA → ABIERTA y EN_CIERRE → EN_CIERRE son transición inválida", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect((await falla(x, cerrarSql, [a.sesion, s.admin.id]))?.message).toMatch(/sesion_caja_transicion_invalida/);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'ABIERTA' WHERE "id" = $1`, [a.sesion]))?.message).toMatch(/sesion_caja_transicion_invalida/);
    expect(await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id])).toBeNull();
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE' WHERE "id" = $1`, [a.sesion]))?.message).toMatch(/sesion_caja_transicion_invalida/);
    await x.query("ROLLBACK");
  });

  it("EN_CIERRE → ABIERTA (cancelar el cierre) pasa SOLO sin las marcas del cierre", async () => {
    const x = await comoApp();
    const a = await armar(x);
    await iniciar(x, a);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'ABIERTA' WHERE "id" = $1`, [a.sesion]))?.code, "volver a ABIERTA dejando el cierre iniciado lo frena el CHECK de marcas").toBe("23514");
    expect(await falla(x, `UPDATE "SesionCaja" SET "estado" = 'ABIERTA', "cierreIniciadoEn" = NULL, "cierreIniciadoPorId" = NULL WHERE "id" = $1`, [a.sesion])).toBeNull();
    expect((await x.query(`SELECT "estado" FROM "SesionCaja" WHERE "id" = $1`, [a.sesion])).rows[0].estado).toBe("ABIERTA");
    await x.query("ROLLBACK");
  });

  it("EN_CIERRE → CERRADA pasa y no deja cambiar quién ni cuándo inició el cierre", async () => {
    const x = await comoApp();
    const a = await armar(x);
    await iniciar(x, a);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2, "cierreIniciadoEn" = now() + interval '1 hour' WHERE "id" = $1`, [a.sesion, s.admin.id]))?.message).toMatch(/sesion_caja_al_cerrar_no_cambia_quien_inicio_el_cierre/);
    expect(await falla(x, cerrarSql, [a.sesion, s.admin.id])).toBeNull();
    await x.query("ROLLBACK");
  });

  it("un estado que no es de la lista (PAUSADA) es 23514 (CHECK SesionCaja_estado_chk)", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'PAUSADA' WHERE "id" = $1`, [a.sesion]))?.code).toBe("23514");
    await x.query("ROLLBACK");
  });

  it("la CERRADA, ya confirmada, no se toca: ni a ABIERTA ni a EN_CIERRE ni nada", async () => {
    const x = await comoApp();
    const a = await armar(x);
    // Un fondo de cero, un arqueo que cuadra y el cierre: queda CERRADA y confirmada.
    await x.query(`INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","creadoPorId") VALUES ($1,$2,$3,'FONDO_INICIAL',$4,0,$5)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo, s.admin.id]);
    await iniciar(x, a);
    await x.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,0,0,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await x.query(cerrarSql, [a.sesion, s.admin.id]);
    await x.query("COMMIT");
    const y = await comoApp();
    for (const destino of ["ABIERTA", "EN_CIERRE", "CERRADA"]) {
      expect((await falla(y, `UPDATE "SesionCaja" SET "estado" = '${destino}' WHERE "id" = $1`, [a.sesion]))?.message, `CERRADA → ${destino}`).toMatch(/sesion_caja_cerrada_no_se_toca/);
    }
    expect((await falla(y, `UPDATE "SesionCaja" SET "observacion" = 'x' WHERE "id" = $1`, [a.sesion]))?.message).toMatch(/sesion_caja_cerrada_no_se_toca/);
    // Y con la sesión cerrada ni entra plata ni entra el conteo.
    expect((await movimiento(y, a, "INGRESO_MANUAL", "1.00"))?.message).toMatch(/sesion_caja_no_abierta/);
    expect((await arqueo(y, a))?.message).toMatch(/sesion_caja_no_en_cierre/);
    await y.query("ROLLBACK");
  });

  it("el índice único «una sin cerrar por caja» cubre EN_CIERRE: con la sesión contándose no se abre otra (23505)", async () => {
    const x = await comoApp();
    const a = await armar(x);
    await iniciar(x, a);
    const otra = `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaPorId","claveIdempotencia","huella") VALUES ($1,$2,$3,'ABIERTA','2026-01-15','America/Argentina/Buenos_Aires',$4,$5,$6)`;
    expect((await falla(x, otra, [randomUUID(), s.sucursalId, a.caja, s.admin.id, randomUUID(), HUELLA]))?.code).toBe("23505");
    await x.query("ROLLBACK");
  });
});

describe("marcas del cierre según el estado (CHECK SesionCaja_marcas_chk)", () => {
  const insertarSesion = (x: Client, a: Armado, estado: string, columnas: string, valores: string) =>
    falla(x, `INSERT INTO "SesionCaja" ("id","sucursalId","cajaId","estado","fechaDeNegocio","zonaHoraria","abiertaPorId","claveIdempotencia","huella"${columnas}) VALUES ($1,$2,$3,'${estado}','2026-01-15','America/Argentina/Buenos_Aires',$4,$5,$6${valores})`, [randomUUID(), s.sucursalId, a.caja, s.admin.id, randomUUID(), HUELLA]);

  it("una sesión ABIERTA con el cierre iniciado o con observación no entra (CHECK de marcas); y tocar sus marcas sin cambiar de estado es transición inválida", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect((await falla(x, `UPDATE "SesionCaja" SET "cierreIniciadoEn" = now() WHERE "id" = $1`, [a.sesion]))?.message).toMatch(/sesion_caja_transicion_invalida/);
    expect((await insertarSesion(x, a, "ABIERTA", `,"cierreIniciadoEn"`, `,now()`))?.code, "una sesión que nace ABIERTA con el cierre iniciado").toBe("23514");
    expect((await insertarSesion(x, a, "ABIERTA", `,"observacion"`, `,'x'`))?.code, "una sesión que nace ABIERTA con observación").toBe("23514");
    await x.query("ROLLBACK");
  });

  it("EN_CIERRE exige quién y cuándo, y no admite cierre ni observación (23514); CERRADA no admite el cierre iniciado a medias", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE' WHERE "id" = $1`, [a.sesion]))?.code, "sin cierreIniciado*").toBe("23514");
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now() WHERE "id" = $1`, [a.sesion]))?.code, "solo el cuándo").toBe("23514");
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]))?.code, "solo el quién").toBe("23514");
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = $2, "observacion" = 'x' WHERE "id" = $1`, [a.sesion, s.admin.id]))?.code, "con observación").toBe("23514");
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'EN_CIERRE', "cierreIniciadoEn" = now(), "cierreIniciadoPorId" = $2, "cerradaEn" = now(), "cerradaPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]))?.code, "con cierre").toBe("23514");
    await iniciar(x, a);
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'CERRADA', "cerradaEn" = now(), "cerradaPorId" = $2, "cierreIniciadoPorId" = NULL WHERE "id" = $1`, [a.sesion, s.admin.id]))?.code, "CERRADA con el cierre iniciado a medias").toBe("23514");
    expect((await falla(x, `UPDATE "SesionCaja" SET "estado" = 'CERRADA' WHERE "id" = $1`, [a.sesion]))?.code, "CERRADA sin quién ni cuándo cerró").toBe("23514");
    await x.query("ROLLBACK");
  });

  it("la app sigue sin poder cambiar el resto de la sesión (privilegio por columna) y sin borrarla", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect((await falla(x, `UPDATE "SesionCaja" SET "fechaDeNegocio" = '2026-02-01' WHERE "id" = $1`, [a.sesion]))?.code).toBe("42501");
    expect((await falla(x, `UPDATE "SesionCaja" SET "abiertaPorId" = $2 WHERE "id" = $1`, [a.sesion, s.admin.id]))?.code).toBe("42501");
    expect((await falla(x, `DELETE FROM "SesionCaja"`))?.code).toBe("42501");
    await x.query("ROLLBACK");
  });
});

describe("qué entra según el estado: plata solo con ABIERTA, conteo solo con EN_CIERRE", () => {
  it("con la sesión ABIERTA entra el movimiento y NO entra el conteo (arqueo ni billetes)", async () => {
    const x = await comoApp();
    const a = await armar(x);
    expect(await movimiento(x, a, "INGRESO_MANUAL", "1.00")).toBeNull();
    expect((await arqueo(x, a))?.message).toMatch(/sesion_caja_no_en_cierre/);
    expect((await billete(x, a))?.message).toMatch(/sesion_caja_no_en_cierre/);
    await x.query("ROLLBACK");
  });

  it("con la sesión EN_CIERRE NO entra plata (movimiento de ninguna clase) y SÍ entra el conteo", async () => {
    const x = await comoApp();
    const a = await armar(x);
    await iniciar(x, a);
    for (const [clase, importe] of [["COBRO", "1.00"], ["INGRESO_MANUAL", "1.00"], ["EGRESO_MANUAL", "-1.00"], ["FONDO_INICIAL", "1.00"]] as const) {
      expect((await movimiento(x, a, clase, importe))?.message, clase).toMatch(/sesion_caja_no_abierta/);
    }
    expect(await arqueo(x, a)).toBeNull();
    expect(await billete(x, a)).toBeNull();
    await x.query("ROLLBACK");
  });

  it("una cobranza no entra con la sesión EN_CIERRE (aunque la cuenta esté cerrada)", async () => {
    const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 72 } });
    const cuenta = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA, mesaId: mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(Date.now() - 86_400_000), cerradaPorId: s.admin.id } });
    const x = await comoApp();
    const a = await armar(x);
    const cobranza = `INSERT INTO "Cobranza" ("id","sucursalId","cuentaId","sesionId","total","claveIdempotencia","huella","creadoPorId") VALUES ($1,$2,$3,$4,10.00,$5,$6,$7)`;
    const params = () => [randomUUID(), s.sucursalId, cuenta.id, a.sesion, randomUUID(), HUELLA, s.admin.id];
    await iniciar(x, a);
    expect((await falla(x, cobranza, params()))?.message).toMatch(/sesion_caja_no_abierta/);
    await x.query("UPDATE \"SesionCaja\" SET \"estado\" = 'ABIERTA', \"cierreIniciadoEn\" = NULL, \"cierreIniciadoPorId\" = NULL WHERE \"id\" = $1", [a.sesion]);
    expect((await falla(x, cobranza, params()))?.message, "cancelado el cierre vuelve a entrar (falla recién al COMMIT por no cuadrar, no por el estado)").toBeUndefined();
    await x.query("ROLLBACK");
  });

  it("cerrar sigue verificándose al COMMIT: un cierre desde EN_CIERRE con arqueo que no cuadra no se confirma", async () => {
    const x = await comoApp();
    const a = await armar(x);
    await x.query(`INSERT INTO "MovimientoCaja" ("id","sucursalId","sesionId","clase","medioDePagoId","importe","creadoPorId") VALUES ($1,$2,$3,'FONDO_INICIAL',$4,100.00,$5)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo, s.admin.id]);
    await iniciar(x, a);
    await x.query(`INSERT INTO "ArqueoCaja" ("id","sucursalId","sesionId","medioDePagoId","esperado","contado","conforme") VALUES ($1,$2,$3,$4,0.00,0.00,false)`, [randomUUID(), s.sucursalId, a.sesion, a.efectivo]);
    await x.query(cerrarSql, [a.sesion, s.admin.id]);
    await expect(x.query("COMMIT")).rejects.toThrow(/cierre_arqueo_no_cuadra_con_los_movimientos/);
  });
});

describe("iniciar el cierre contra un movimiento en vuelo (FOR SHARE): el cierre espera y lo cuenta", () => {
  it("un movimiento sin confirmar frena el inicio del cierre hasta que confirma; después el movimiento está y la sesión está EN_CIERRE", async () => {
    const colocar = await comoApp();
    const a = await armar(colocar);
    await colocar.query("COMMIT");

    const mov = await comoApp();
    expect(await movimiento(mov, a, "INGRESO_MANUAL", "7.00")).toBeNull();
    const cierre = await comoApp();
    const esperando = iniciar(cierre, a).then(() => "terminó");
    const primero = await Promise.race([esperando, new Promise<string>((r) => setTimeout(() => r("espera"), 500))]);
    expect(primero, "el inicio del cierre espera al movimiento en vuelo").toBe("espera");
    await mov.query("COMMIT");
    expect(await esperando).toBe("terminó");
    await cierre.query("COMMIT");
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.sesion } })).estado).toBe("EN_CIERRE");
    expect(await prismaAdmin.movimientoCaja.count({ where: { sesionId: a.sesion, clase: "INGRESO_MANUAL" } })).toBe(1);
  });
});
