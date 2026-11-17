import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { decidirCancelarCierre, decidirCerrar, decidirIniciarCierre, decidirMovimiento } from "../../src/core/caja/public";
import { azarDelProceso } from "../../src/lib/azar";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { anularMovimientoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/anular-movimiento";
import { cancelarCierreDeSesion } from "../../src/server/actions/caja/casos-de-uso/cancelar-cierre";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { iniciarCierreDeSesion } from "../../src/server/actions/caja/casos-de-uso/iniciar-cierre";
import { registrarAjusteCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/registrar-ajuste";
import { registrarMovimientoManualCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/registrar-movimiento-manual";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { CASOS_DE_USO_DECLARADOS, COMANDOS, ESTADOS, ORACULO, type ComandoDelOraculo, type EstadoDelOraculo } from "./oraculo-de-estados-de-sesion";

/**
 * Caja y cobro, etapa C1b (docs/diseno-caja-c1b-en-cierre-2026-11-16.md): la sesión pasa por ABIERTA → EN_CIERRE → CERRADA. Contra Postgres real y con las carreras de verdad (`Promise.allSettled` desde conexiones distintas).
 * El recorrido exhaustivo estado × comando se compara con el ORÁCULO (`oraculo-de-estados-de-sesion.ts`, escrito aparte del código). Mutaciones que dejan esto en ROJO: sacar `CAJA_EN_CIERRE` de los casos de uso de movimientos y
 * cobro, hacer que `cerrarSesionCasoDeUso` acepte la sesión ABIERTA, quitar la rama «ya estaba» de iniciar o de cancelar el cierre, y las de las reglas de la base (`reglas-de-la-base-de-caja-c1b.test.ts`).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const c = (n: number) => BigInt(n);

const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, empresaZonaHoraria: "America/Argentina/Buenos_Aires", ...baseDeEmpresa(EMPRESA, { lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
const abrir = (fondo = 100_00) => abrirSesionCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fondoEnCentavos: c(fondo) }, azarDelProceso);
const iniciar = (sesionId: string) => iniciarCierreDeSesion(actor(), { sesionId });
const cancelar = (sesionId: string) => cancelarCierreDeSesion(actor(), { sesionId });
const mover = (sesionId: string, sentido: "INGRESO" | "EGRESO", importe: number) =>
  registrarMovimientoManualCasoDeUso(actor(), { claveIdempotencia: randomUUID(), sesionId, sentido, importeEnCentavos: c(importe), motivo: "cambio" }, azarDelProceso);
const cerrar = (sesionId: string, billetes: Record<number, number>, monedas = 0) =>
  cerrarSesionCasoDeUso(actor(), { sesionId, conteo: { billetes: billetes as never, monedasEnCentavos: c(monedas) }, conformeDeLosDemasMedios: false, observacion: null }, azarDelProceso);
const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const cobrar = (cuentaId: string, ef: string, total: number) =>
  cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cuentaId, totalVistoEnCentavos: c(total), renglones: [{ medioDePagoId: ef, importeEnCentavos: c(total) }] }, azarDelProceso);
async function cuentaCerrada(precio = 3000) {
  const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}
/** Una jornada anterior ya CERRADA (lo que un ajuste corrige), armada por la puerta de atrás con el dueño de la base. */
async function jornadaAnteriorCerrada(fecha: string) {
  const j = await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: new Date(`${fecha}T00:00:00.000Z`) } });
  await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "EN_AUDITORIA", auditoriaIniciadaEn: AHORA, auditoriaIniciadaPorId: s.admin.id } });
  await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "CERRADA", cerradaEn: AHORA, cerradaPorId: s.admin.id, huellaDeCierre: "a".repeat(64) } });
}
const estadoDe = async (sesionId: string) => (await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: sesionId } })).estado;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

// El fondo es $100,00 y se mueve un ingreso de $10,00 (lo que después se anula): lo esperado en efectivo es $110,00.
const CONTEO_QUE_CUADRA = { billetes: { 100: 1, 10: 1 }, monedas: 0 };
const CONTEO_CON_SOBRANTE = { billetes: { 100: 1, 10: 1 }, monedas: 50_00 };

describe("el oráculo estado × comando contra los casos de uso reales (recorrido exhaustivo)", () => {
  async function celda(estado: EstadoDelOraculo, comando: ComandoDelOraculo) {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const sesionId = a.datos.sesionId;
    const ingreso = await mover(sesionId, "INGRESO", 10_00);
    if (!ingreso.ok) throw new Error("no movió");
    // El ajuste (C2) corrige una jornada ANTERIOR ya cerrada: se deja armada antes de fotografiar.
    if (comando === "ajuste") await jornadaAnteriorCerrada("2026-01-08");
    const cuenta = comando === "cobrar" ? await cuentaCerrada(3000) : null;
    if (estado !== "ABIERTA") expect((await iniciar(sesionId)).ok).toBe(true);
    if (estado === "CERRADA") expect((await cerrar(sesionId, CONTEO_QUE_CUADRA.billetes)).ok).toBe(true);

    const antes = { movimientos: await prismaAdmin.movimientoCaja.count(), sesiones: await prismaAdmin.sesionCaja.count(), auditorias: await prismaAdmin.registroAuditoria.count() };
    let r: { ok: boolean; codigo?: string; datos?: Record<string, unknown> };
    switch (comando) {
      case "iniciarCierre": r = await iniciar(sesionId); break;
      case "cancelarCierre": r = await cancelar(sesionId); break;
      case "cerrarConElMismoConteo": r = await cerrar(sesionId, CONTEO_QUE_CUADRA.billetes); break;
      case "cerrarConOtroConteo": r = await cerrar(sesionId, CONTEO_CON_SOBRANTE.billetes, CONTEO_CON_SOBRANTE.monedas); break;
      case "cobrar": r = await cobrar((cuenta as { id: string }).id, await efectivoId(), 3000_00); break;
      case "ingresoManual": r = await mover(sesionId, "INGRESO", 5_00); break;
      case "egresoManual": r = await mover(sesionId, "EGRESO", 5_00); break;
      case "anularMovimiento": r = await anularMovimientoCasoDeUso(actor(), { claveIdempotencia: randomUUID(), movimientoId: ingreso.datos.movimientoId, motivo: "me equivoqué" }, true, azarDelProceso); break;
      case "ajuste": r = await registrarAjusteCasoDeUso(actor(), { claveIdempotencia: randomUUID(), sesionId, medioDePagoId: await efectivoId(), importeEnCentavos: c(-5_00), motivo: "Falto un vale", corrigeJornada: "2026-01-08" }, true, azarDelProceso); break;
      case "abrir": r = await abrir(100_00); break;
    }
    const despues = { movimientos: await prismaAdmin.movimientoCaja.count(), sesiones: await prismaAdmin.sesionCaja.count(), auditorias: await prismaAdmin.registroAuditoria.count() };
    const yaEstaba = r.ok ? (Object.entries(r.datos ?? {}).find(([k]) => /^(yaEstaba|yaExistia)/.test(k))?.[1] as boolean | undefined) ?? null : null;
    return { resultado: r.ok ? "OK" : (r.codigo as string), yaEstaba, estadoDespues: await estadoDe(sesionId), movimientosNuevos: despues.movimientos - antes.movimientos, sesionesNuevas: despues.sesiones - antes.sesiones, auditoriasNuevas: despues.auditorias - antes.auditorias };
  }

  for (const comando of COMANDOS) {
    for (const estado of ESTADOS) {
      it(`${comando} con la sesión ${estado}`, async () => {
        const e = ORACULO[comando][estado];
        expect(await celda(estado, comando)).toEqual(e);
      });
    }
  }

  it("GUARDIÁN: el oráculo tiene una respuesta para cada estado de la base y cada comando, y cada caso de uso de la carpeta está declarado", async () => {
    // Los estados que admite la base (CHECK) son EXACTAMENTE los del oráculo: un estado nuevo hace fallar esto hasta que se declare qué pasa con cada comando.
    const def = await prismaAdmin.$queryRawUnsafe<{ d: string }[]>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'SesionCaja_estado_chk'`);
    const deLaBase = [...def[0].d.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(deLaBase).toEqual([...ESTADOS].sort());
    expect(Object.keys(ORACULO).sort()).toEqual([...COMANDOS].sort());
    for (const comando of COMANDOS) expect(Object.keys(ORACULO[comando]).sort(), `estados de ${comando}`).toEqual([...ESTADOS].sort());
    // Cada archivo de casos de uso de la caja está declarado con los comandos que cubre, y cada comando del oráculo tiene un caso de uso.
    const archivos = readdirSync(join(__dirname, "../../src/server/actions/caja/casos-de-uso")).filter((f) => f.endsWith(".ts")).sort();
    expect(archivos).toEqual(Object.keys(CASOS_DE_USO_DECLARADOS).sort());
    expect(Object.values(CASOS_DE_USO_DECLARADOS).flat().sort()).toEqual([...COMANDOS].sort());
  });

  it("el núcleo puro dice lo mismo que el oráculo (cada decisión por estado coincide con el resultado esperado)", () => {
    for (const estado of ESTADOS) {
      const m = decidirMovimiento(estado);
      expect(m === "ENTRA" ? "OK" : m).toBe(ORACULO.ingresoManual[estado].resultado);
      expect(m === "ENTRA" ? "OK" : m).toBe(ORACULO.anularMovimiento[estado].resultado);
      expect(m === "ENTRA" ? "OK" : m).toBe(ORACULO.ajuste[estado].resultado);
      const i = decidirIniciarCierre(estado);
      expect(i === "SESION_CERRADA" ? i : "OK").toBe(ORACULO.iniciarCierre[estado].resultado);
      expect(i === "YA_ESTABA").toBe(ORACULO.iniciarCierre[estado].yaEstaba === true);
      const k = decidirCancelarCierre(estado);
      expect(k === "SESION_CERRADA" ? k : "OK").toBe(ORACULO.cancelarCierre[estado].resultado);
      expect(k === "YA_ESTABA").toBe(ORACULO.cancelarCierre[estado].yaEstaba === true);
      const z = decidirCerrar(estado);
      expect(z === "SESION_NO_EN_CIERRE" ? z : "OK").toBe(ORACULO.cerrarConElMismoConteo[estado].resultado);
    }
  });
});

describe("cerrar de nuevo una sesión cerrada compara el conteo ENTERO (total y billetes)", () => {
  it("mismo total con OTROS billetes no es el mismo pedido (SESION_CERRADA); mismos billetes, aunque pasen con cantidad cero de más, sí es el repetido", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const id = a.datos.sesionId;
    expect((await iniciar(id)).ok).toBe(true);
    expect((await cerrar(id, { 100: 1 })).ok).toBe(true);
    expect(await cerrar(id, { 50: 2 }), "$100,00 con otros billetes").toMatchObject({ ok: false, codigo: "SESION_CERRADA" });
    expect(await cerrar(id, { 100: 1, 50: 0 }), "los mismos billetes más un cero").toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
    expect(await cerrar(id, { 100: 1 })).toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
  });
});

describe("iniciar y cancelar el cierre: marcas, auditoría y repetición", () => {
  it("iniciar sella quién y cuándo y audita; repetir no cambia nada; cancelar vuelve sin marcas y cobrar vuelve a entrar", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const id = a.datos.sesionId;
    expect(await iniciar(id)).toMatchObject({ ok: true, datos: { yaEstabaEnCierre: false } });
    const enCierre = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id } });
    expect(enCierre).toMatchObject({ estado: "EN_CIERRE", cierreIniciadoPorId: s.admin.id, cierreIniciadoEn: AHORA, cerradaEn: null, cerradaPorId: null });
    expect(await iniciar(id)).toMatchObject({ ok: true, datos: { yaEstabaEnCierre: true } });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_iniciado" } })).toBe(1);

    const cuenta = await cuentaCerrada();
    const ef = await efectivoId();
    expect(await cobrar(cuenta.id, ef, 3000_00)).toMatchObject({ ok: false, codigo: "CAJA_EN_CIERRE", sesionId: id });
    expect(await cancelar(id)).toMatchObject({ ok: true, datos: { yaEstabaAbierta: false } });
    expect(await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id } })).toMatchObject({ estado: "ABIERTA", cierreIniciadoEn: null, cierreIniciadoPorId: null });
    expect(await cancelar(id)).toMatchObject({ ok: true, datos: { yaEstabaAbierta: true } });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_cancelado" } })).toBe(1);
    expect(await cobrar(cuenta.id, ef, 3000_00)).toMatchObject({ ok: true });
  });

  it("al cerrar queda quién inició el cierre y cuándo, y el cierre arranca desde EN_CIERRE (la auditoría lo dice)", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    await iniciar(a.datos.sesionId);
    expect(await cerrar(a.datos.sesionId, {})).toMatchObject({ ok: true, datos: { yaEstabaCerrada: false } });
    expect(await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } })).toMatchObject({ estado: "CERRADA", cierreIniciadoPorId: s.admin.id, cerradaPorId: s.admin.id });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre", valorAnterior: "EN_CIERRE" } })).toBe(1);
  });

  it("datos faltantes: iniciar, cancelar y cerrar sin sesión (o de otra sucursal) dan SESION_NO_ENCONTRADA y no escriben", async () => {
    const otra = randomUUID();
    const antes = await prismaAdmin.registroAuditoria.count();
    expect(await iniciar(otra)).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await cancelar(otra)).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await cerrar(otra, {})).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(antes);
  });

  it("error parcial: cerrar con «conforme» faltante deja la sesión EN_CIERRE, sin arqueo escrito, y el reintento completo cierra", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada();
    const tarjeta = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo: "TARJETA_DEBITO" } });
    await cobrar(cuenta.id, tarjeta.id, 3000_00);
    await iniciar(a.datos.sesionId);
    expect(await cerrar(a.datos.sesionId, { 100: 1 })).toMatchObject({ ok: false, codigo: "CONFORME_FALTANTE" });
    expect(await estadoDe(a.datos.sesionId)).toBe("EN_CIERRE");
    expect(await prismaAdmin.arqueoCaja.count({ where: { sesionId: a.datos.sesionId } })).toBe(0);
    expect(await prismaAdmin.arqueoBillete.count({ where: { sesionId: a.datos.sesionId } })).toBe(0);
    const r = await cerrarSesionCasoDeUso(actor(), { sesionId: a.datos.sesionId, conteo: { billetes: { 100: 1 } as never, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: true, observacion: null }, azarDelProceso);
    expect(r).toMatchObject({ ok: true, datos: { yaEstabaCerrada: false } });
  });

  it("reintento: cancelar y volver a iniciar el cierre sella de nuevo quién y cuándo", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    await iniciar(a.datos.sesionId);
    await cancelar(a.datos.sesionId);
    const otra = { ...actor(), ahora: new Date("2026-01-15T16:00:00.000Z") };
    expect(await iniciarCierreDeSesion(otra, { sesionId: a.datos.sesionId })).toMatchObject({ ok: true, datos: { yaEstabaEnCierre: false } });
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } })).cierreIniciadoEn).toEqual(new Date("2026-01-15T16:00:00.000Z"));
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_iniciado" } })).toBe(2);
  });
});

describe("concurrencia del cierre de caja (conexiones distintas, carreras de verdad)", { timeout: 60_000 }, () => {
  it("ocho iniciarCierreDeSesion a la vez dejan la sesión EN_CIERRE y UNA sola auditoría", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => iniciarCierreDeSesion(actor(), { sesionId: a.datos.sesionId })));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && x.value.datos.yaEstabaEnCierre === false)).toHaveLength(1);
    expect(await estadoDe(a.datos.sesionId)).toBe("EN_CIERRE");
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_iniciado" } })).toBe(1);
  });

  it("ocho cancelarCierreDeSesion a la vez dejan la sesión ABIERTA y UNA sola auditoría", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    await iniciar(a.datos.sesionId);
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => cancelarCierreDeSesion(actor(), { sesionId: a.datos.sesionId })));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && x.value.datos.yaEstabaAbierta === false)).toHaveLength(1);
    expect(await estadoDe(a.datos.sesionId)).toBe("ABIERTA");
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre_cancelado" } })).toBe(1);
  });

  it("ocho cerrarSesionCasoDeUso a la vez con el mismo conteo cierran UNA vez, con un solo arqueo", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    await iniciar(a.datos.sesionId);
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => cerrar(a.datos.sesionId, { 100: 1 })));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && x.value.datos.yaEstabaCerrada === false)).toHaveLength(1);
    expect(await estadoDe(a.datos.sesionId)).toBe("CERRADA");
    expect(await prismaAdmin.arqueoCaja.count({ where: { sesionId: a.datos.sesionId } })).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "SesionCaja", campo: "cierre" } })).toBe(1);
  });

  it("cobros a la vez con iniciarCierreDeSesion: cada cobro confirmado entra al conteo y el resto da CAJA_EN_CIERRE; el cierre cuadra siempre", async () => {
    const ef0 = { id: "" };
    for (let ronda = 0; ronda < 5; ronda++) {
      const a = await abrir(0);
      if (!a.ok) throw new Error("no abrió");
      const cuentas = [];
      for (let i = 0; i < 4; i++) cuentas.push(await cuentaCerrada(3000));
      ef0.id = await efectivoId();
      const rs = await Promise.allSettled([
        iniciarCierreDeSesion(actor(), { sesionId: a.datos.sesionId }),
        ...cuentas.map((cu) => cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cuentaId: cu.id, totalVistoEnCentavos: c(3000_00), renglones: [{ medioDePagoId: ef0.id, importeEnCentavos: c(3000_00) }] }, azarDelProceso)),
      ]);
      expect(rs.every((x) => x.status === "fulfilled"), `ronda ${ronda}: ninguna promesa se rechaza`).toBe(true);
      const resultados = rs.map((x) => (x as PromiseFulfilledResult<{ ok: boolean; codigo?: string }>).value);
      expect(resultados[0].ok, `ronda ${ronda}: iniciar el cierre siempre puede`).toBe(true);
      for (const r of resultados.slice(1)) expect(r.ok || r.codigo === "CAJA_EN_CIERRE", `ronda ${ronda}: un cobro entra o da CAJA_EN_CIERRE, nunca otra cosa`).toBe(true);
      const entraron = resultados.slice(1).filter((r) => r.ok).length;
      expect(await estadoDe(a.datos.sesionId)).toBe("EN_CIERRE");
      expect(await prismaAdmin.movimientoCaja.count({ where: { sesionId: a.datos.sesionId, clase: "COBRO" } }), `ronda ${ronda}: cobros guardados = cobros que dijeron ok`).toBe(entraron);
      // El conteo de lo que entró cuadra al centavo: cada cobro son $3.000 = un billete de 2000 y uno de 1000.
      const cierre = await cerrar(a.datos.sesionId, entraron === 0 ? {} : { 2000: entraron, 1000: entraron });
      expect(cierre, `ronda ${ronda}`).toMatchObject({ ok: true, datos: { diferenciaEnEfectivoEnCentavos: c(0) } });
    }
  });
});
