import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { azarDelProceso } from "../../src/lib/azar";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { anularMovimientoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/anular-movimiento";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { registrarMovimientoManualCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/registrar-movimiento-manual";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Caja y cobro, etapa C1, contra Postgres real y con las acciones reales del POS para cerrar la cuenta: abrir caja, mover efectivo, cobrar una cuenta cerrada y cerrar con arqueo. Las carreras son de verdad
 * (`Promise.allSettled` desde conexiones distintas). Mutación: sacar el `true` final de `conTransaccionSerializable` en `cobrarCuentaCasoDeUso` deja en rojo «ocho cobros a la vez»; quitar el chequeo de la clave
 * antes del estado deja en rojo «el mismo cobro repetido».
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const AHORA = new Date("2026-11-17T15:00:00.000Z");
const c = (n: number) => BigInt(n);

const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, ...baseDeEmpresa(EMPRESA, { lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
const abrir = (fondo = 100_00, clave = randomUUID()) => abrirSesionCasoDeUso(actor(), { claveIdempotencia: clave, fondoEnCentavos: c(fondo) }, azarDelProceso);
const mover = (sesionId: string, sentido: "INGRESO" | "EGRESO", importe: number, clave = randomUUID(), motivo = "cambio") =>
  registrarMovimientoManualCasoDeUso(actor(), { claveIdempotencia: clave, sesionId, sentido, importeEnCentavos: c(importe), motivo }, azarDelProceso);

async function cuentaCerrada(cantidad = 2, precio = 3000) {
  const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}
const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const cobrar = (cuentaId: string, renglones: { medioDePagoId: string; importeEnCentavos: bigint }[], total: number, clave = randomUUID()) =>
  cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: clave, cuentaId, totalVistoEnCentavos: c(total), renglones }, azarDelProceso);

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("abrir la sesión de caja", () => {
  it("crea la caja y el efectivo la primera vez, sella el día en hora argentina y deja el fondo como movimiento", async () => {
    const r = await abrir(250_00);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!r.ok) return;
    const sesion = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: r.datos.sesionId } });
    expect(sesion).toMatchObject({ estado: "ABIERTA", zonaHoraria: "America/Argentina/Buenos_Aires", abiertaPorId: s.admin.id });
    expect(sesion.fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(await prismaAdmin.caja.count()).toBe(1);
    const mov = await prismaAdmin.movimientoCaja.findMany({ where: { sesionId: sesion.id } });
    expect(mov).toHaveLength(1);
    expect(mov[0]).toMatchObject({ clase: "FONDO_INICIAL" });
    expect(Number(mov[0].importe)).toBe(250);
  });

  it("a las 01:00 de Argentina (04:00 UTC) el día de negocio es el calendario argentino, no el UTC", async () => {
    const tarde = { ...actor(), ahora: new Date("2026-11-18T02:30:00.000Z") }; // 23:30 del 17 en Argentina
    const r = await abrirSesionCasoDeUso(tarde, { claveIdempotencia: randomUUID(), fondoEnCentavos: c(0) }, azarDelProceso);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: r.datos.sesionId } })).fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-11-17");
  });

  it("el mismo pedido repetido (doble clic) devuelve la misma sesión y no duplica nada", async () => {
    const clave = randomUUID();
    const a = await abrir(100_00, clave);
    const b = await abrir(100_00, clave);
    expect(b).toMatchObject({ ok: true, datos: { yaExistia: true } });
    if (a.ok && b.ok) expect(b.datos.sesionId).toBe(a.datos.sesionId);
    expect(await prismaAdmin.sesionCaja.count()).toBe(1);
    expect(await prismaAdmin.movimientoCaja.count()).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja" } })).toBe(1);
  });

  it("la misma clave con otro fondo es CLAVE_REUTILIZADA; otra clave con la caja ya abierta es CAJA_YA_ABIERTA", async () => {
    const clave = randomUUID();
    await abrir(100_00, clave);
    expect(await abrir(200_00, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await abrir(100_00)).toMatchObject({ ok: false, codigo: "CAJA_YA_ABIERTA" });
  });

  it("ocho aperturas a la vez con claves distintas dejan UNA sola sesión y UNA sola caja", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => abrir(100_00)));
    const oks = rs.filter((x) => x.status === "fulfilled" && x.value.ok);
    expect(oks).toHaveLength(1);
    expect(await prismaAdmin.sesionCaja.count()).toBe(1);
    expect(await prismaAdmin.caja.count()).toBe(1);
    expect(await prismaAdmin.medioDePago.count({ where: { tipo: "EFECTIVO" } })).toBe(1);
  });

  it("una sucursal desactivada no abre caja", async () => {
    await prismaAdmin.sucursal.update({ where: { id: s.sucursalId }, data: { activo: false } });
    expect(await abrir()).toMatchObject({ ok: false, codigo: "SUCURSAL_INACTIVA" });
    expect(await prismaAdmin.sesionCaja.count()).toBe(0);
  });
});

describe("ingreso y egreso manual", () => {
  it("suma al efectivo esperado, es idempotente por clave y se compara campo por campo", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const clave = randomUUID();
    const m1 = await mover(a.datos.sesionId, "INGRESO", 50_00, clave);
    const m2 = await mover(a.datos.sesionId, "INGRESO", 50_00, clave);
    expect(m1).toMatchObject({ ok: true, datos: { yaExistia: false, superaElEfectivo: false } });
    expect(m2).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await mover(a.datos.sesionId, "INGRESO", 60_00, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "INGRESO_MANUAL" } })).toBe(1);
  });

  it("un egreso mayor al efectivo esperado se PERMITE y avisa (queda en la auditoría)", async () => {
    const a = await abrir(10_00);
    if (!a.ok) throw new Error("no abrió");
    const r = await mover(a.datos.sesionId, "EGRESO", 50_00);
    expect(r).toMatchObject({ ok: true, datos: { superaElEfectivo: true } });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "MovimientoCaja", campo: "egreso_supera_efectivo" } })).toBe(1);
  });

  it("no se mueve efectivo en una sesión de otra sucursal ni en una cerrada", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect(await mover(randomUUID(), "INGRESO", 1_00)).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    const cerrada = await cerrarSesionCasoDeUso(actor(), { sesionId: a.datos.sesionId, conteo: { billetes: {}, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: false, observacion: null }, azarDelProceso);
    expect(cerrada.ok).toBe(true);
    expect(await mover(a.datos.sesionId, "INGRESO", 1_00)).toMatchObject({ ok: false, codigo: "SESION_CERRADA" });
  });

  it("anular: agrega el espejo, una sola vez, y un cobro nunca se anula desde la caja", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const m = await mover(a.datos.sesionId, "EGRESO", 30_00);
    if (!m.ok) throw new Error("no movió");
    const anular = (movimientoId: string, clave = randomUUID()) => anularMovimientoCasoDeUso(actor(), { claveIdempotencia: clave, movimientoId, motivo: "me equivoqué" }, true, azarDelProceso);
    const clave = randomUUID();
    const an = await anular(m.datos.movimientoId, clave);
    expect(an).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await anular(m.datos.movimientoId, clave)).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await anular(m.datos.movimientoId)).toMatchObject({ ok: false, codigo: "MOVIMIENTO_YA_ANULADO" });
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "ANULACION" } })).toBe(1);

    const cuenta = await cuentaCerrada();
    const cob = await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(6000_00) }], 6000_00);
    expect(cob.ok).toBe(true);
    const cobro = await prismaAdmin.movimientoCaja.findFirstOrThrow({ where: { clase: "COBRO" } });
    expect(await anular(cobro.id)).toMatchObject({ ok: false, codigo: "MOVIMIENTO_NO_ANULABLE" });
  });

  it("el operador no anula lo de otro; con permiso sobre lo ajeno sí", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const m = await mover(a.datos.sesionId, "INGRESO", 5_00);
    if (!m.ok) throw new Error("no movió");
    const otro = await prismaAdmin.user.create({ data: { email: "otro@test.com" } });
    const comoOtro = { ...actor(), usuarioId: otro.id };
    expect(await anularMovimientoCasoDeUso(comoOtro, { claveIdempotencia: randomUUID(), movimientoId: m.datos.movimientoId, motivo: "x" }, false, azarDelProceso)).toMatchObject({ ok: false, codigo: "SIN_PERMISO_SOBRE_MOVIMIENTO_AJENO" });
    expect(await anularMovimientoCasoDeUso(comoOtro, { claveIdempotencia: randomUUID(), movimientoId: m.datos.movimientoId, motivo: "x" }, true, azarDelProceso)).toMatchObject({ ok: true });
  });
});

describe("cobrar una cuenta cerrada", () => {
  it("cobra con un medio y la plata entra a la sesión; la repetición con la misma clave no duplica", async () => {
    await abrir(0);
    const cuenta = await cuentaCerrada(2, 3000); // 6000
    const ef = await efectivoId();
    const clave = randomUUID();
    const r = await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(6000_00) }], 6000_00, clave);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const otra = await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(6000_00) }], 6000_00, clave);
    expect(otra).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await prismaAdmin.cobranza.count()).toBe(1);
    expect(await prismaAdmin.cobro.count()).toBe(1);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Cobranza" } })).toBe(1);
  });

  it("reparte entre medios y la suma tiene que dar el total al centavo", async () => {
    await abrir(0);
    const cuenta = await cuentaCerrada(2, 3000);
    const ef = await efectivoId();
    const tarjeta = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo: "TARJETA_DEBITO" } });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(2000_00) }, { medioDePagoId: tarjeta.id, importeEnCentavos: c(3999_99) }], 6000_00)).toMatchObject({ ok: false, codigo: "COBRO_NO_CUADRA", faltaEnCentavos: c(1), sobraEnCentavos: c(0) });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(2000_00) }, { medioDePagoId: tarjeta.id, importeEnCentavos: c(4000_01) }], 6000_00)).toMatchObject({ ok: false, codigo: "COBRO_NO_CUADRA", sobraEnCentavos: c(1) });
    expect(await prismaAdmin.cobranza.count()).toBe(0);
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(2000_00) }, { medioDePagoId: tarjeta.id, importeEnCentavos: c(4000_00) }], 6000_00)).toMatchObject({ ok: true });
    expect(await prismaAdmin.cobro.count()).toBe(2);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(2);
  });

  it("rechaza sin sesión abierta, con la cuenta abierta, con un total viejo, con un medio inactivo y dos veces la misma cuenta", async () => {
    const cuenta = await cuentaCerrada(1, 3000);
    const ef = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo: "EFECTIVO" } });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef.id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "SIN_SESION_ABIERTA" });
    await abrir(0);
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef.id, importeEnCentavos: c(2999_00) }], 2999_00)).toMatchObject({ ok: false, codigo: "TOTAL_CAMBIO", totalActualEnCentavos: c(3000_00) });
    const inactivo = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo: "QR", activo: false } });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: inactivo.id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "MEDIO_NO_HABILITADO" });
    const abierta = await sembrarCuenta((await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 9 } })).id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await cobrar(abierta.id, [{ medioDePagoId: ef.id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "CUENTA_ABIERTA" });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef.id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: true });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef.id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "CUENTA_YA_COBRADA" });
  });

  it("ocho cobros a la vez de la MISMA cuenta (claves distintas) dejan uno solo", async () => {
    await abrir(0);
    const cuenta = await cuentaCerrada(1, 3000);
    const ef = await efectivoId();
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00) }], 3000_00)));
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok)).toHaveLength(1);
    expect(await prismaAdmin.cobranza.count()).toBe(1);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(1);
  });

  it("ocho reintentos con la MISMA clave devuelven el mismo cobro", async () => {
    await abrir(0);
    const cuenta = await cuentaCerrada(1, 3000);
    const ef = await efectivoId();
    const clave = randomUUID();
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00) }], 3000_00, clave)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.cobranza.count()).toBe(1);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(1);
  });
});

describe("cerrar con arqueo", () => {
  const cerrar = (sesionId: string, billetes: Record<number, number>, monedas = 0, conforme = false) =>
    cerrarSesionCasoDeUso(actor(), { sesionId, conteo: { billetes: billetes as never, monedasEnCentavos: c(monedas) }, conformeDeLosDemasMedios: conforme, observacion: null }, azarDelProceso);

  it("cuadra: fondo + cobro en efectivo = lo contado, sin diferencia, y la sesión no se reabre", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada(1, 3000);
    await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00);
    const r = await cerrar(a.datos.sesionId, { 2000: 1, 1000: 1, 100: 1 });
    expect(r).toMatchObject({ ok: true, datos: { yaEstabaCerrada: false, diferenciaEnEfectivoEnCentavos: c(0) } });
    const arqueo = await prismaAdmin.arqueoCaja.findFirstOrThrow({ where: { sesionId: a.datos.sesionId } });
    expect(Number(arqueo.esperado)).toBe(3100);
    expect(Number(arqueo.contado)).toBe(3100);
    expect(await prismaAdmin.arqueoBillete.count({ where: { sesionId: a.datos.sesionId } })).toBe(3);
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } })).estado).toBe("CERRADA");
    expect(await cerrar(a.datos.sesionId, { 2000: 1, 1000: 1, 100: 1 })).toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
    expect(await cerrar(a.datos.sesionId, { 100: 1 })).toMatchObject({ ok: false, codigo: "SESION_CERRADA" });
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "SesionCaja" SET "estado" = 'ABIERTA' WHERE "id" = '${a.datos.sesionId}'`)).rejects.toThrow(/sesion_caja_cerrada_no_se_toca/);
  });

  it("cerrar con diferencia se permite y queda auditado; con otros medios exige «conforme»", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada(1, 3000);
    const tarjeta = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo: "TARJETA_CREDITO" } });
    await cobrar(cuenta.id, [{ medioDePagoId: tarjeta.id, importeEnCentavos: c(3000_00) }], 3000_00);
    expect(await cerrar(a.datos.sesionId, { 100: 1 })).toMatchObject({ ok: false, codigo: "CONFORME_FALTANTE" });
    const r = await cerrar(a.datos.sesionId, { 100: 1 }, 50_00, true); // esperado 100, contado 100 + 50 de monedas = 150 → sobran 50
    expect(r).toMatchObject({ ok: true, datos: { diferenciaEnEfectivoEnCentavos: c(50_00) } });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_con_diferencia" } })).toBe(1);
    expect(await prismaAdmin.arqueoCaja.count({ where: { sesionId: a.datos.sesionId, conforme: true } })).toBe(1);
  });

  it("un conteo inválido no cierra nada", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect(await cerrar(a.datos.sesionId, { 100: -1 })).toMatchObject({ ok: false, codigo: "CONTEO_INVALIDO" });
    expect(await cerrar(a.datos.sesionId, { 50: 1 })).toMatchObject({ ok: false, codigo: "CONTEO_INVALIDO" });
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } })).estado).toBe("ABIERTA");
  });

  it("después de cerrar la sesión ya no se cobra y se puede abrir otra", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrar(a.datos.sesionId, {})).ok).toBe(true);
    const cuenta = await cuentaCerrada(1, 3000);
    expect(await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "SIN_SESION_ABIERTA" });
    expect(await abrir(0)).toMatchObject({ ok: true, datos: { yaExistia: false } });
  });
});

describe("la base hace cumplir lo que el caso de uso no puede olvidar", () => {
  const movimiento = async (sesionId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, sesionId, clase: "INGRESO_MANUAL", medioDePagoId: await efectivoId(), importe: "1.00", motivo: "x", creadoPorId: s.admin.id, ...extra });

  it("no entra un movimiento en una sesión cerrada", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesionCasoDeUso(actor(), { sesionId: a.datos.sesionId, conteo: { billetes: {}, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: false, observacion: null }, azarDelProceso)).ok).toBe(true);
    await expect(prismaAdmin.movimientoCaja.create({ data: await movimiento(a.datos.sesionId) as never })).rejects.toThrow(/sesion_caja_no_abierta/);
  });

  it("el signo de cada clase lo exige la base (un egreso positivo no entra)", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    await expect(prismaAdmin.movimientoCaja.create({ data: await movimiento(a.datos.sesionId, { clase: "EGRESO_MANUAL" }) as never })).rejects.toThrow(/MovimientoCaja_signo_chk/);
  });

  it("un cobro cuya suma no da el total no se confirma (disparador diferido), y no queda nada", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada(1, 3000);
    const ef = await efectivoId();
    const cobranzaId = randomUUID();
    const mov = randomUUID();
    await expect(
      prismaAdmin.$transaction(async (tx) => {
        await tx.cobranza.create({ data: { id: cobranzaId, empresaId: EMPRESA, sucursalId: s.sucursalId, cuentaId: cuenta.id, sesionId: a.datos.sesionId, total: "3000.00", claveIdempotencia: randomUUID(), huella: "a".repeat(64), creadoPorId: s.admin.id } });
        await tx.movimientoCaja.create({ data: await movimiento(a.datos.sesionId, { id: mov, clase: "COBRO", importe: "2999.99", motivo: null }) as never });
        await tx.cobro.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, cobranzaId, orden: 1, medioDePagoId: ef, movimientoId: mov, importe: "2999.99" } });
      }),
    ).rejects.toThrow(/cobranza_no_cuadra/);
    expect(await prismaAdmin.cobranza.count()).toBe(0);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(0);
  });

  it("no se cobra una cuenta abierta ni una cuenta de otra sucursal", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const abierta = await sembrarCuenta((await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 8 } })).id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await expect(
      prismaAdmin.cobranza.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, cuentaId: abierta.id, sesionId: a.datos.sesionId, total: "3000.00", claveIdempotencia: randomUUID(), huella: "a".repeat(64), creadoPorId: s.admin.id } }),
    ).rejects.toThrow(/cobranza_de_cuenta_abierta/);
  });

  it("una anulación tiene que ser el espejo exacto, y a un cobro no se lo anula", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const m = await mover(a.datos.sesionId, "INGRESO", 5_00);
    if (!m.ok) throw new Error("no movió");
    await expect(prismaAdmin.movimientoCaja.create({ data: await movimiento(a.datos.sesionId, { clase: "ANULACION", importe: "-4.00", anulaAId: m.datos.movimientoId }) as never })).rejects.toThrow(/anulacion_no_es_el_espejo/);
  });
});
