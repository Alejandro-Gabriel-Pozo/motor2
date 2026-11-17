import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { fechaDeColumnaDate } from "../../src/core/tiempo/zona-horaria";
import { azarDelProceso } from "../../src/lib/azar";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { cerrarJornadaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-jornada";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { iniciarCierreDeSesion } from "../../src/server/actions/caja/casos-de-uso/iniciar-cierre";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { corregirMedioDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/corregir-medio-de-cobro";
import { darConformeGeneralCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/dar-conforme-general";
import { declararTotalCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/declarar-total";
import { leerControlesDeLaJornada } from "../../src/server/actions/caja/casos-de-uso/controles-de-la-jornada";
import { iniciarAuditoriaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/iniciar-auditoria";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { insertarCierreDeCaja, insertarLineasDeConciliacion, insertarOrigenesDeConciliacion } from "../../src/server/persistencia/caja/jornada";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Caja y cobro, etapa C2b (la foto congelada de la conciliación por medio, como Pedernal), contra Postgres real. Se escribe DENTRO de `cerrarJornada` (todo o nada) con la jornada ya cerrada en esa transacción; la base la recalcula al confirmar y exige que sea
 * igual (`CierreDeCajaDeJornada_verificar`). El oráculo de conteo (estado según declaración, conforme general y cierres) está en `oraculo-de-jornada.ts` y se recorre exhaustivo en `nucleo-de-jornada.test.ts`; acá se prueba que la base y el caso de uso coinciden con él en los
 * estados alcanzables, y las segundas barreras de la base con fotos manipuladas. Mutación: cambiar un `<>` por `=` en el disparador `CierreDeCajaDeJornada_verificar` deja en rojo «una foto con una línea alterada no se confirma».
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
// Un día PASADO fijo (test/setup/tiempo.ts): 15/01/2026 a las 12:00 en Argentina.
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const D = "2026-01-15";
const ZONA = "America/Argentina/Buenos_Aires";
const c = (n: number) => BigInt(n);
const col = fechaDeColumnaDate;

const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, empresaZonaHoraria: ZONA, ...baseDeEmpresa(EMPRESA, { lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
const abrir = (fondo = 0) => abrirSesionCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fondoEnCentavos: c(fondo) }, azarDelProceso);
// C1b: la sesión se cierra desde EN_CIERRE; iniciar el cierre es idempotente.
const cerrarSesion = async (sesionId: string, billetes: Record<number, number> = {}) => {
  await iniciarCierreDeSesion(actor(), { sesionId });
  return cerrarSesionCasoDeUso(actor(), { sesionId, conteo: { billetes: billetes as never, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: true, observacion: null }, azarDelProceso);
};
const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const medio = (tipo: "TARJETA_DEBITO" | "QR") => prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo } });
const cobrar = (cuentaId: string, medioDePagoId: string) => cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cuentaId, totalVistoEnCentavos: c(3000_00), renglones: [{ medioDePagoId, importeEnCentavos: c(3000_00) }] }, azarDelProceso);
const iniciar = () => iniciarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: D });
const corregir = (cobroId: string, medioDestinoId: string) => corregirMedioDeCobroCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cobroId, medioDestinoId, motivo: "Se cargo en el medio equivocado" }, azarDelProceso);
const declarar = (medioDePagoId: string, importe: number) => declararTotalCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fechaDeNegocio: D, medioDePagoId, importeEnCentavos: c(importe) }, azarDelProceso);
const conformeGeneral = () => darConformeGeneralCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fechaDeNegocio: D }, azarDelProceso);
const jornada = () => prismaAdmin.jornadaDeSucursal.findFirstOrThrow({ where: { sucursalId: s.sucursalId, fechaDeNegocio: col(D) } });
const controles = async () => leerControlesDeLaJornada(prismaAdmin, { empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: D, jornadaId: (await jornada()).id, zonaHoraria: ZONA, ahora: AHORA });
const cerrarJornada = async (reconocimientos: { clave: string; texto: string | null }[] = [], observacion: string | null = null) => cerrarJornadaCasoDeUso(actor(), { fechaDeNegocio: D, huellaVista: (await controles()).huella, reconocimientos, observacion }, azarDelProceso);
const num = (d: unknown) => (d === null || d === undefined ? null : Number(d));

async function cuentaCerrada(numeroDeMesa?: number) {
  const mesaId = numeroDeMesa === undefined ? s.mesa.id : (await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: numeroDeMesa } })).id;
  const cuenta = await sembrarCuenta(mesaId, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}

/** El día cobrado: $100 de fondo, una cuenta de $3.000 en efectivo y otra de $3.000 con tarjeta, caja cerrada contando $3.100. Deja al admin con el cierre del día EMPEZADO. */
async function diaEnCierre() {
  const a = await abrir(100_00);
  if (!a.ok) throw new Error("no abrió");
  const tarjeta = await medio("TARJETA_DEBITO");
  const ef = await efectivoId();
  const c1 = await cuentaCerrada();
  expect((await cobrar(c1.id, ef)).ok).toBe(true);
  const c2 = await cuentaCerrada(5);
  expect((await cobrar(c2.id, tarjeta.id)).ok).toBe(true);
  expect((await cerrarSesion(a.datos.sesionId, { 2000: 1, 1000: 1, 100: 1 })).ok).toBe(true);
  expect((await iniciar()).ok).toBe(true);
  const cobroTarjeta = await prismaAdmin.cobro.findFirstOrThrow({ where: { medioDePagoId: tarjeta.id } });
  return { sesionId: a.datos.sesionId, tarjeta, ef, c1, c2, cobroTarjeta };
}

const lineas = async () => (await prismaAdmin.conciliacionDeJornada.findMany({ include: { medioDePago: true }, orderBy: { medioDePago: { tipo: "asc" } } })).map((l) => ({ tipo: l.medioDePago.tipo, registrado: num(l.registrado), correcciones: num(l.correcciones), declarado: num(l.declarado), estado: l.estadoDeConteo, conformePorId: l.conformePorId, diferencia: num(l.diferencia), explicacion: l.explicacion }));

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("la foto de la conciliación por medio se congela al cerrar el día", () => {
  it("camino feliz: efectivo CONTADO, tarjeta CONFORME (tras la corrección) y QR DECLARADO; la diferencia la calcula la base", async () => {
    const d = await diaEnCierre();
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    expect((await declarar(qr.id, 3000_00)).ok).toBe(true);
    expect(await cerrarJornada()).toMatchObject({ ok: true });
    const cierre = await prismaAdmin.cierreDeCajaDeJornada.findFirstOrThrow();
    expect(cierre).toMatchObject({ jornadaId: (await jornada()).id, congeladoPorId: s.admin.id, sucursalId: s.sucursalId });
    expect(cierre.congeladoEn.toISOString()).toBe(AHORA.toISOString());
    expect(await lineas()).toEqual([
      { tipo: "EFECTIVO", registrado: 3100, correcciones: 0, declarado: 3100, estado: "CONTADO", conformePorId: null, diferencia: 0, explicacion: null },
      { tipo: "QR", registrado: 0, correcciones: 3000, declarado: 3000, estado: "DECLARADO", conformePorId: null, diferencia: 0, explicacion: null },
      { tipo: "TARJETA_DEBITO", registrado: 3000, correcciones: -3000, declarado: null, estado: "CONFORME", conformePorId: s.admin.id, diferencia: null, explicacion: null },
    ]);
    expect(await prismaAdmin.conciliacionDeCobroPorOrigen.count()).toBe(0);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CierreDeCajaDeJornada", campo: "congelado" } })).toBe(1);
  });

  it("un medio sin dato (SIN_DATO) hay que reconocerlo y su explicación se copia SOLO a la línea que había que explicar", async () => {
    const d = await diaEnCierre();
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    expect(await cerrarJornada([{ clave: "caja.conciliacion_por_medio", texto: "El QR no tiene resumen todavia" }])).toMatchObject({ ok: true });
    expect(await lineas()).toEqual([
      { tipo: "EFECTIVO", registrado: 3100, correcciones: 0, declarado: 3100, estado: "CONTADO", conformePorId: null, diferencia: 0, explicacion: null },
      { tipo: "QR", registrado: 0, correcciones: 3000, declarado: null, estado: "SIN_DATO", conformePorId: null, diferencia: null, explicacion: "El QR no tiene resumen todavia" },
      { tipo: "TARJETA_DEBITO", registrado: 3000, correcciones: -3000, declarado: null, estado: "CONFORME", conformePorId: s.admin.id, diferencia: null, explicacion: null },
    ]);
  });

  it("el conforme general da CONFORME al medio sin declarar, con quién y cuándo; una declaración explícita lo gana y deja su diferencia", async () => {
    const d = await diaEnCierre();
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    expect((await conformeGeneral()).ok).toBe(true);
    expect((await declarar(d.tarjeta.id, 2900_00)).ok).toBe(true); // la tarjeta declara 2900 contra 3000 − 3000 = 0 registrado neto: sobran 2900
    expect(await cerrarJornada([{ clave: "caja.conciliacion_por_medio", texto: "Diferencia de la terminal" }])).toMatchObject({ ok: true });
    const l = await lineas();
    expect(l.find((x) => x.tipo === "QR")).toMatchObject({ estado: "CONFORME", conformePorId: s.admin.id, declarado: null, diferencia: null, explicacion: null });
    expect(l.find((x) => x.tipo === "TARJETA_DEBITO")).toMatchObject({ estado: "DECLARADO", declarado: 2900, diferencia: 2900, explicacion: "Diferencia de la terminal" });
    expect((await prismaAdmin.conciliacionDeJornada.findFirstOrThrow({ where: { estadoDeConteo: "CONFORME" } })).conformeEn?.toISOString()).toBe(AHORA.toISOString());
  });

  it("anular un ticket entero ya cobrado queda congelado como origen con diferencia (cobrado − total), con la explicación del reconocimiento", async () => {
    const d = await diaEnCierre();
    const operaciones = (await prismaAdmin.cuentaItem.findMany({ where: { cuentaId: d.c1.id }, select: { operacionId: true } })).flatMap((i) => (i.operacionId ? [i.operacionId] : []));
    await prismaAdmin.operacion.updateMany({ where: { id: { in: operaciones } }, data: { anuladaEn: new Date("2026-01-15T14:00:00.000Z"), anuladaPorId: s.admin.id } });
    expect(await cerrarJornada([{ clave: "caja.cobrado_contra_ticket", texto: "Se anulo el ticket" }])).toMatchObject({ ok: true });
    const origen = await prismaAdmin.conciliacionDeCobroPorOrigen.findFirstOrThrow({ include: { cobranza: true } });
    expect(origen).toMatchObject({ cobranzaId: (await prismaAdmin.cobranza.findFirstOrThrow({ where: { cuentaId: d.c1.id } })).id, explicacion: "Se anulo el ticket" });
    expect([num(origen.cobrado), num(origen.totalDelTicket), num(origen.diferencia)]).toEqual([3000, 0, 3000]);
    expect(await prismaAdmin.conciliacionDeCobroPorOrigen.count()).toBe(1);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } }), "la anulación del ticket no mueve la caja").toBe(2);
  });

  it("un día con la caja en cero también deja su foto: cabecera y la línea del efectivo", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await iniciar()).ok).toBe(true);
    expect(await cerrarJornada()).toMatchObject({ ok: true });
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(1);
    expect(await lineas()).toEqual([{ tipo: "EFECTIVO", registrado: 0, correcciones: 0, declarado: 0, estado: "CONTADO", conformePorId: null, diferencia: 0, explicacion: null }]);
  });

  it("si la jornada no se puede cerrar no queda NADA de la foto (todo o nada)", async () => {
    const d = await diaEnCierre();
    await prismaAdmin.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id } }).catch(() => undefined);
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    // SIN_DATO sin reconocer: el cierre se rechaza y la foto no se escribe.
    expect(await cerrarJornada()).toMatchObject({ ok: false });
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(0);
    expect(await prismaAdmin.conciliacionDeJornada.count()).toBe(0);
    expect((await jornada()).estado).toBe("EN_AUDITORIA");
  });
});

describe("idempotencia y concurrencia de la foto", () => {
  it("repetir el cierre no duplica la foto", async () => {
    await diaEnCierre();
    const huella = (await controles()).huella;
    const pedido = { fechaDeNegocio: D, huellaVista: huella, reconocimientos: [], observacion: null };
    expect((await cerrarJornadaCasoDeUso(actor(), pedido, azarDelProceso)).ok).toBe(true);
    expect(await cerrarJornadaCasoDeUso(actor(), pedido, azarDelProceso)).toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(1);
    expect(await prismaAdmin.conciliacionDeJornada.count()).toBe(2);
  });

  it("seis cerrarJornada a la vez dejan UNA cabecera y una línea por medio", async () => {
    await diaEnCierre();
    const huella = (await controles()).huella;
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => cerrarJornadaCasoDeUso(actor(), { fechaDeNegocio: D, huellaVista: huella, reconocimientos: [], observacion: null }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok), JSON.stringify(rs.map((x) => (x.status === "fulfilled" ? (x.value.ok ? "OK" : x.value.codigo) : "RECHAZADA")))).toBe(true);
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(1);
    expect(await prismaAdmin.conciliacionDeJornada.count()).toBe(2);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CierreDeCajaDeJornada" } })).toBe(1);
  });
});

describe("la base hace cumplir la foto (segundas barreras, con fotos manipuladas)", () => {
  /** Cierra la jornada «a mano», como dueño de la base, y escribe la foto que se le pase DENTRO de la misma transacción: sirve para probar lo que la base acepta o rechaza al confirmar. */
  async function cerrarYCongelar(armar: (tx: Parameters<Parameters<typeof prismaAdmin.$transaction>[0]>[0], ctx: { cierreId: string; jornadaId: string; conciliacion: Awaited<ReturnType<typeof controles>>["conciliacion"]; origenes: Awaited<ReturnType<typeof controles>>["origenesConDiferencia"] }) => Promise<void>) {
    const j = await jornada();
    const vista = await controles();
    return prismaAdmin.$transaction(async (tx) => {
      await tx.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "CERRADA", cerradaEn: AHORA, cerradaPorId: s.admin.id, huellaDeCierre: vista.huella } });
      const cierreId = randomUUID();
      await insertarCierreDeCaja(tx, { id: cierreId, empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId: j.id, congeladoEn: AHORA, congeladoPorId: s.admin.id });
      await armar(tx, { cierreId, jornadaId: j.id, conciliacion: vista.conciliacion, origenes: vista.origenesConDiferencia });
    });
  }
  const aLineas = (conciliacion: Awaited<ReturnType<typeof controles>>["conciliacion"]) => conciliacion.map((l) => ({ id: randomUUID(), medioDePagoId: l.medioDePagoId, registradoEnCentavos: l.registradoEnCentavos, correccionesEnCentavos: l.correccionesEnCentavos, declaradoEnCentavos: l.declaradoEnCentavos, estadoDeConteo: l.estado, conformePorId: l.conformePorId, conformeEn: l.conformeEn, explicacion: null }));
  const poner = (tx: Parameters<Parameters<typeof prismaAdmin.$transaction>[0]>[0], cierreId: string, ls: ReturnType<typeof aLineas>) => insertarLineasDeConciliacion(tx, { empresaId: EMPRESA, sucursalId: s.sucursalId, cierreId, lineas: ls });

  it("la foto correcta se confirma (la misma que arma el caso de uso)", async () => {
    await diaEnCierre();
    await expect(cerrarYCongelar((tx, x) => poner(tx, x.cierreId, aLineas(x.conciliacion)))).resolves.toBeUndefined();
    expect(await prismaAdmin.conciliacionDeJornada.count()).toBe(2);
  });

  it("una foto con una línea alterada no se confirma, y no queda nada", async () => {
    await diaEnCierre();
    await expect(cerrarYCongelar((tx, x) => poner(tx, x.cierreId, aLineas(x.conciliacion).map((l, i) => (i === 0 ? { ...l, registradoEnCentavos: l.registradoEnCentavos + c(1) } : l))))).rejects.toThrow(/caja_conciliacion_no_cuadra/);
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(0);
    expect((await jornada()).estado).toBe("EN_AUDITORIA");
  });

  it("una foto con un estado de conteo que no es el que resulta no se confirma (el efectivo declarado, un conforme inventado)", async () => {
    await diaEnCierre();
    const ef = await efectivoId();
    await expect(cerrarYCongelar((tx, x) => poner(tx, x.cierreId, aLineas(x.conciliacion).map((l) => (l.medioDePagoId === ef ? { ...l, estadoDeConteo: "DECLARADO" } : l))))).rejects.toThrow(/el_efectivo_es_siempre_contado/);
    await expect(cerrarYCongelar((tx, x) => poner(tx, x.cierreId, aLineas(x.conciliacion).map((l) => (l.medioDePagoId !== ef ? { ...l, estadoDeConteo: "SIN_DATO", conformePorId: null, conformeEn: null } : l))))).rejects.toThrow(/caja_conciliacion_no_cuadra/);
  });

  it("una foto incompleta (falta el medio con movimientos) o con un medio de más no se confirma", async () => {
    await diaEnCierre();
    await expect(cerrarYCongelar((tx, x) => poner(tx, x.cierreId, aLineas(x.conciliacion).slice(0, 1)))).rejects.toThrow(/caja_conciliacion_incompleta/);
    await expect(cerrarYCongelar(async () => undefined)).rejects.toThrow(/caja_conciliacion_incompleta/);
    const qr = await medio("QR");
    await expect(
      cerrarYCongelar((tx, x) => poner(tx, x.cierreId, [...aLineas(x.conciliacion), { id: randomUUID(), medioDePagoId: qr.id, registradoEnCentavos: c(0), correccionesEnCentavos: c(0), declaradoEnCentavos: null, estadoDeConteo: "SIN_DATO", conformePorId: null, conformeEn: null, explicacion: null }])),
    ).rejects.toThrow(/caja_conciliacion_incompleta/);
  });

  it("un origen con un cobrado que no es la suma real de sus cobros no se confirma; la cobranza tiene que ser de la jornada", async () => {
    const d = await diaEnCierre();
    const cobranza = await prismaAdmin.cobranza.findFirstOrThrow({ where: { cuentaId: d.c1.id } });
    const origen = (cobrado: bigint) => ({ id: randomUUID(), cobranzaId: cobranza.id, cobradoEnCentavos: cobrado, totalDelTicketEnCentavos: c(0), explicacion: null });
    await expect(cerrarYCongelar(async (tx, x) => { await poner(tx, x.cierreId, aLineas(x.conciliacion)); await insertarOrigenesDeConciliacion(tx, { empresaId: EMPRESA, sucursalId: s.sucursalId, cierreId: x.cierreId, origenes: [origen(c(2999_00))] }); })).rejects.toThrow(/caja_conciliacion_no_cuadra/);
    await expect(cerrarYCongelar(async (tx, x) => { await poner(tx, x.cierreId, aLineas(x.conciliacion)); await insertarOrigenesDeConciliacion(tx, { empresaId: EMPRESA, sucursalId: s.sucursalId, cierreId: x.cierreId, origenes: [origen(c(3000_00))] }); })).resolves.toBeUndefined();
    // Un origen que no difiere (cobrado = total del ticket) no entra: solo los que difieren.
    expect(await prismaAdmin.conciliacionDeCobroPorOrigen.count()).toBe(1);
  });

  it("la foto no se puede sembrar con la jornada abierta ni agregarle líneas a una foto de antes", async () => {
    await diaEnCierre();
    const j = await jornada();
    await expect(insertarCierreDeCaja(prismaAdmin, { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId: j.id, congeladoEn: AHORA, congeladoPorId: s.admin.id })).rejects.toThrow(/foto_de_caja_solo_al_cerrar_la_jornada/);
    expect(await cerrarJornada()).toMatchObject({ ok: true });
    const cierre = await prismaAdmin.cierreDeCajaDeJornada.findFirstOrThrow();
    const ef = await efectivoId();
    await expect(insertarLineasDeConciliacion(prismaAdmin, { empresaId: EMPRESA, sucursalId: s.sucursalId, cierreId: cierre.id, lineas: [{ id: randomUUID(), medioDePagoId: ef, registradoEnCentavos: c(0), correccionesEnCentavos: c(0), declaradoEnCentavos: c(0), estadoDeConteo: "CONTADO", conformePorId: null, conformeEn: null, explicacion: null }] })).rejects.toThrow(/lineas_de_la_foto_solo_con_su_cabecera_en_la_misma_transaccion/);
    await expect(insertarCierreDeCaja(prismaAdmin, { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId: j.id, congeladoEn: AHORA, congeladoPorId: s.admin.id })).rejects.toThrow(/foto_de_caja_solo_al_cerrar_la_jornada/);
  });

  it("las reglas de forma de la línea: el estado manda sobre el declarado y el conforme; la explicación es de la lista de permitidos", async () => {
    await diaEnCierre();
    const qr = await medio("QR");
    const base = (cierreId: string, extra: Record<string, unknown>) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, cierreId, medioDePagoId: qr.id, registrado: "1.00", correcciones: "0.00", estadoDeConteo: "DECLARADO", declarado: "1.00", ...extra });
    const intentar = (extra: Record<string, unknown>) => cerrarYCongelar((tx, x) => tx.conciliacionDeJornada.create({ data: base(x.cierreId, extra) as never }).then(() => undefined));
    await expect(intentar({ estadoDeConteo: "OTRO" })).rejects.toThrow(/ConciliacionDeJornada_(estado|datos)_chk/);
    await expect(intentar({ declarado: null })).rejects.toThrow(/ConciliacionDeJornada_datos_chk/);
    await expect(intentar({ conformePorId: s.admin.id, conformeEn: AHORA })).rejects.toThrow(/ConciliacionDeJornada_datos_chk/);
    await expect(intentar({ explicacion: "con <html>" })).rejects.toThrow(/ConciliacionDeJornada_explicacion_chk/);
    await expect(intentar({ diferencia: "5.00" })).rejects.toThrow();
    expect(await prismaAdmin.conciliacionDeJornada.count()).toBe(0);
  });
});
