import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { fechaDeNegocio } from "../../src/core/caja/public";
import { fechaDeColumnaDate } from "../../src/core/tiempo/zona-horaria";
import { azarDelProceso } from "../../src/lib/azar";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { anularMovimientoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/anular-movimiento";
import { cancelarAuditoriaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cancelar-auditoria";
import { cerrarJornadaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-jornada";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { corregirMedioDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/corregir-medio-de-cobro";
import { darConformeGeneralCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/dar-conforme-general";
import { declararTotalCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/declarar-total";
import { iniciarAuditoriaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/iniciar-auditoria";
import { registrarAjusteCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/registrar-ajuste";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { leerControlesDeLaJornada } from "../../src/server/actions/caja/casos-de-uso/controles-de-la-jornada";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { COMANDOS_DE_JORNADA, ESTADOS_A_RECORRER, ORACULO_DE_AJUSTE, ORACULO_ESTADO_POR_COMANDO, ORACULO_REPETICION, type ComandoDeJornada, type EstadoDeLaJornada, type JornadaACorregir } from "./oraculo-de-jornada";

/**
 * Caja y cobro, etapa C2 (jornada y cierre del día), contra Postgres real y con las acciones reales del POS para cerrar la cuenta. Recorre EXHAUSTIVAMENTE el oráculo (`oraculo-de-jornada.ts`, escrito aparte): estado de la jornada × comando y
 * permiso × sesión × jornada que se corrige. Las carreras son de verdad (`Promise.allSettled` desde conexiones distintas). Mutación: sacar el `FOR UPDATE` de `bloquearJornadaParaCambiar` deja en rojo «seis cierres a la vez»; sacar el chequeo
 * de la clave antes del estado en `declararTotalCasoDeUso` deja en rojo «la misma declaración repetida»; sacar la comparación de huellas de `decidirCierre` deja en rojo «la huella vista».
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
// Un día PASADO fijo (las fechas absolutas recientes o futuras se vuelven falsas con el tiempo, test/setup/tiempo.ts): 15/01/2026 a las 12:00 en Argentina.
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const D = "2026-01-15";
const ZONA = "America/Argentina/Buenos_Aires";
const c = (n: number) => BigInt(n);
const col = fechaDeColumnaDate;

const actor = (ahora = AHORA) => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora, empresaZonaHoraria: ZONA, ...baseDeEmpresa(EMPRESA, { lectura: [s.sucursalId], escritura: [s.sucursalId] }) });
const abrir = (fondo = 0, ahora = AHORA, clave = randomUUID()) => abrirSesionCasoDeUso(actor(ahora), { claveIdempotencia: clave, fondoEnCentavos: c(fondo) }, azarDelProceso);
const unico = (r: { ok: boolean; codigo?: string }) => (r.ok ? "OK" : (r.codigo as string));

async function cuentaCerrada(cantidad = 1, precio = 3000) {
  const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}
const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const medio = (tipo: "TARJETA_DEBITO" | "TARJETA_CREDITO" | "QR" | "TRANSFERENCIA", extra: { activo?: boolean } = {}) => prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo, ...extra } });
const cobrar = (cuentaId: string, renglones: { medioDePagoId: string; importeEnCentavos: bigint }[], total: number, ahora = AHORA) => cobrarCuentaCasoDeUso(actor(ahora), { claveIdempotencia: randomUUID(), cuentaId, totalVistoEnCentavos: c(total), renglones }, azarDelProceso);
const cerrarSesion = (sesionId: string, billetes: Record<number, number> = {}, monedas = 0, ahora = AHORA) =>
  cerrarSesionCasoDeUso(actor(ahora), { sesionId, conteo: { billetes: billetes as never, monedasEnCentavos: c(monedas) }, conformeDeLosDemasMedios: true, observacion: null }, azarDelProceso);

const iniciar = (fecha = D) => iniciarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: fecha });
const cancelar = (fecha = D) => cancelarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: fecha });
const corregir = (cobroId: string, medioDestinoId: string, clave = randomUUID(), motivo = "Se cargo en el medio equivocado") => corregirMedioDeCobroCasoDeUso(actor(), { claveIdempotencia: clave, cobroId, medioDestinoId, motivo }, azarDelProceso);
const declarar = (medioDePagoId: string, importe: number, clave = randomUUID(), fecha = D) => declararTotalCasoDeUso(actor(), { claveIdempotencia: clave, fechaDeNegocio: fecha, medioDePagoId, importeEnCentavos: c(importe) }, azarDelProceso);
const conforme = (clave = randomUUID(), fecha = D) => darConformeGeneralCasoDeUso(actor(), { claveIdempotencia: clave, fechaDeNegocio: fecha }, azarDelProceso);
const cerrarJornada = (huellaVista: string, reconocimientos: { clave: string; texto: string | null }[] = [], observacion: string | null = null, fecha = D) =>
  cerrarJornadaCasoDeUso(actor(), { fechaDeNegocio: fecha, huellaVista, reconocimientos, observacion }, azarDelProceso);
const ajustar = (sesionId: string, medioDePagoId: string, importe: number, corrigeJornada: string | null, puede = true, clave = randomUUID(), motivo = "Falto un vale") =>
  registrarAjusteCasoDeUso(actor(), { claveIdempotencia: clave, sesionId, medioDePagoId, importeEnCentavos: c(importe), motivo, corrigeJornada }, puede, azarDelProceso);

const jornadaDe = (fecha = D) => prismaAdmin.jornadaDeSucursal.findFirst({ where: { sucursalId: s.sucursalId, fechaDeNegocio: col(fecha) } });
async function huellaDe(fecha = D) {
  const j = await jornadaDe(fecha);
  return leerControlesDeLaJornada(prismaAdmin, { empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: fecha, jornadaId: j?.id ?? null, zonaHoraria: ZONA, ahora: AHORA });
}
const cantidades = async (fecha = D) => Object.fromEntries((await huellaDe(fecha)).controles.map((x) => [x.clave, x.cantidad]));

/** Lleva (con el administrador del dueño de la base, saltando la secuencia de la app) la jornada de esa fecha al estado pedido; la crea si no existe. Las transiciones las valida igual el disparador de la base. */
async function forzarJornada(fecha: string, estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA") {
  let j = await jornadaDe(fecha);
  if (j === null) j = await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: col(fecha) } });
  if (estado !== "ABIERTA" && j.estado === "ABIERTA") await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "EN_AUDITORIA", auditoriaIniciadaEn: AHORA, auditoriaIniciadaPorId: s.admin.id } });
  if (estado === "CERRADA") await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "CERRADA", cerradaEn: AHORA, cerradaPorId: s.admin.id, huellaDeCierre: "a".repeat(64) } });
  return (await jornadaDe(fecha)) as NonNullable<Awaited<ReturnType<typeof jornadaDe>>>;
}

/** El día entero hecho: caja abierta con $100, una cuenta de $3.000 cobrada en efectivo y otra de $3.000 cobrada con tarjeta, la caja cerrada con el efectivo contado y los demás medios «conformes». */
async function diaCobrado() {
  const a = await abrir(100_00);
  if (!a.ok) throw new Error("no abrió");
  const tarjeta = await medio("TARJETA_DEBITO");
  const ef = await efectivoId();
  const c1 = await cuentaCerrada();
  expect((await cobrar(c1.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00) }], 3000_00)).ok).toBe(true);
  const mesa2 = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
  const c2 = await sembrarCuenta(mesa2.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(c2.id)).ok).toBe(true);
  expect((await cobrar(c2.id, [{ medioDePagoId: tarjeta.id, importeEnCentavos: c(3000_00) }], 3000_00)).ok).toBe(true);
  expect((await cerrarSesion(a.datos.sesionId, { 2000: 1, 1000: 1, 100: 1 })).ok).toBe(true);
  const cobroTarjeta = await prismaAdmin.cobro.findFirstOrThrow({ where: { medioDePagoId: tarjeta.id } });
  return { sesionId: a.datos.sesionId, tarjeta, ef, c1, c2, cobroTarjeta };
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("la jornada nace con la primera actividad y la sesión sella la hora de corte", () => {
  it("abrir la caja crea la jornada ABIERTA de ese día; la segunda sesión del día usa la misma", async () => {
    expect(await jornadaDe()).toBeNull();
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    expect(await jornadaDe()).toMatchObject({ estado: "ABIERTA", auditoriaIniciadaEn: null, cerradaEn: null });
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await abrir(0)).ok).toBe(true);
    expect(await prismaAdmin.jornadaDeSucursal.count()).toBe(1);
    const sesion = await prismaAdmin.sesionCaja.findFirstOrThrow();
    expect(sesion.horaDeCorte.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("con corte 06:00: 05:59:59.999 es la jornada del 14 y 06:00:00.000 la del 15, y el sello guarda el corte", async () => {
    await prismaAdmin.sucursal.update({ where: { id: s.sucursalId }, data: { horaDeCorte: new Date("1970-01-01T06:00:00.000Z") } });
    const antes = await abrir(0, new Date("2026-01-15T08:59:59.999Z"));
    if (!antes.ok) throw new Error("no abrió");
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: antes.datos.sesionId } })).fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-14");
    expect((await cerrarSesion(antes.datos.sesionId, {}, 0, new Date("2026-01-15T08:59:59.999Z"))).ok).toBe(true);
    const despues = await abrir(0, new Date("2026-01-15T09:00:00.000Z"));
    if (!despues.ok) throw new Error("no abrió");
    const sesion = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: despues.datos.sesionId } });
    expect(sesion.fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(sesion.horaDeCorte.toISOString()).toBe("1970-01-01T06:00:00.000Z");
    expect((await prismaAdmin.jornadaDeSucursal.findMany({ orderBy: { fechaDeNegocio: "asc" } })).map((j) => j.fechaDeNegocio.toISOString().slice(0, 10))).toEqual(["2026-01-14", "2026-01-15"]);
  });

  it("el pasaje de medianoche: 02:59:59.999 UTC es todavía el 14 argentino y 03:00:00.000 UTC ya es el 15", async () => {
    const a = await abrir(0, new Date("2026-01-15T02:59:59.999Z"));
    if (!a.ok) throw new Error("no abrió");
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } })).fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-14");
    expect((await cerrarSesion(a.datos.sesionId, {}, 0, new Date("2026-01-15T02:59:59.999Z"))).ok).toBe(true);
    const b = await abrir(0, new Date("2026-01-15T03:00:00.000Z"));
    if (!b.ok) throw new Error("no abrió");
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: b.datos.sesionId } })).fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("una sesión abierta pasada su hora de corte SIGUE cobrando en su jornada y avisa; no se abre otra caja encima", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada();
    const manana = new Date("2026-01-16T13:00:00.000Z");
    const r = await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00, manana);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false, jornadaVencida: true } });
    const cobranza = await prismaAdmin.cobranza.findFirstOrThrow({ include: { sesion: true } });
    expect(cobranza.sesion.fechaDeNegocio.toISOString().slice(0, 10)).toBe(D);
    expect(await abrir(0, manana)).toMatchObject({ ok: false, codigo: "CAJA_YA_ABIERTA" });
    expect(await prismaAdmin.jornadaDeSucursal.count()).toBe(1);
  });

  it("el mismo día un cobro no avisa (jornadaVencida falso)", async () => {
    await abrir(0);
    const cuenta = await cuentaCerrada();
    expect(await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: true, datos: { jornadaVencida: false } });
  });

  it("la función de la base y la del núcleo dan la misma fecha de negocio para cada media hora de tres días y varios cortes", async () => {
    const instantes: Date[] = [];
    for (let m = 0; m < 3 * 48; m++) instantes.push(new Date(Date.parse("2026-02-27T00:00:00.000Z") + m * 30 * 60_000 - 1), new Date(Date.parse("2026-02-27T00:00:00.000Z") + m * 30 * 60_000));
    for (const corte of ["00:00", "04:00", "05:30", "06:00", "12:00", "23:59"]) {
      const filas = await prismaAdmin.$queryRawUnsafe<{ i: Date; f: Date }[]>(`SELECT i, caja_fecha_de_negocio(i, '${ZONA}', '${corte}'::time) AS f FROM unnest($1::timestamptz[]) AS i`, instantes);
      for (const f of filas) expect(f.f.toISOString().slice(0, 10), `${f.i.toISOString()} corte ${corte}`).toBe((fechaDeNegocio(f.i, ZONA, corte) as { valor: string }).valor);
    }
  });
});

describe("estado de la jornada × comando (oráculo, exhaustivo)", () => {
  /** Arma el escenario del comando con la jornada de `D` en ese estado y ejecuta el comando; devuelve «OK» o el código. */
  async function correr(comando: ComandoDeJornada, estado: EstadoDeLaJornada): Promise<string> {
    const fijar = async () => {
      if (estado !== "SIN_ACTIVIDAD") await forzarJornada(D, estado);
    };
    switch (comando) {
      case "abrirSesion": {
        await fijar();
        return unico(await abrir(0));
      }
      case "cobrarCuenta": {
        await abrir(0);
        const cuenta = await cuentaCerrada();
        // Una sesión abierta con la jornada en otro estado solo se da forzándolo (el cierre exige las cajas cerradas): la base y el caso de uso lo rechazan igual.
        await fijar();
        return unico(await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00));
      }
      case "iniciarAuditoria": {
        await fijar();
        return unico(await iniciar());
      }
      case "cancelarAuditoria": {
        await fijar();
        return unico(await cancelar());
      }
      case "corregirMedioDeCobro": {
        const d = await diaCobrado();
        const qr = await medio("QR");
        await fijar();
        return unico(await corregir(d.cobroTarjeta.id, qr.id));
      }
      case "declararTotal": {
        await fijar();
        return unico(await declarar((await medio("QR")).id, 3000_00));
      }
      case "darConformeGeneral": {
        await fijar();
        return unico(await conforme());
      }
      case "cerrarJornada": {
        if (estado === "CERRADA") {
          // Cerrada DE VERDAD y repetida con el mismo pedido: responde yaEstabaCerrada.
          await forzarJornada(D, "EN_AUDITORIA");
          const huella = (await huellaDe()).huella;
          expect((await cerrarJornada(huella)).ok).toBe(true);
          return unico(await cerrarJornada(huella));
        }
        await fijar();
        return unico(await cerrarJornada((await huellaDe()).huella));
      }
    }
  }

  for (const comando of COMANDOS_DE_JORNADA) {
    for (const estado of ESTADOS_A_RECORRER) {
      const esperado = ORACULO_ESTADO_POR_COMANDO[comando][estado];
      if (esperado === "NO_APLICA") continue;
      it(`${comando} con la jornada ${estado} → ${esperado}`, async () => {
        expect(await correr(comando, estado)).toBe(esperado);
      });
    }
  }

  it("el oráculo declara todas las combinaciones (ninguna fila falta ni sobra)", () => {
    expect(Object.keys(ORACULO_ESTADO_POR_COMANDO).sort()).toEqual([...COMANDOS_DE_JORNADA].sort());
    for (const comando of COMANDOS_DE_JORNADA) expect(Object.keys(ORACULO_ESTADO_POR_COMANDO[comando]).sort()).toEqual([...ESTADOS_A_RECORRER].sort());
  });

  it("un rechazo no escribe nada: ni filas ni auditoría (jornada cerrada, todos los comandos de cierre)", async () => {
    const d = await diaCobrado();
    await forzarJornada(D, "EN_AUDITORIA");
    expect((await cerrarJornada((await huellaDe()).huella)).ok).toBe(true);
    const foto = async () => ({ jornada: await jornadaDe(), correcciones: await prismaAdmin.correccionDeMedio.count(), declaraciones: await prismaAdmin.declaracionDeTotal.count(), conformes: await prismaAdmin.conformeDeJornada.count(), controles: await prismaAdmin.controlDeJornadaCerrada.count(), auditoria: await prismaAdmin.registroAuditoria.count() });
    const antes = await foto();
    const qr = await medio("QR");
    for (const r of [await iniciar(), await cancelar(), await corregir(d.cobroTarjeta.id, qr.id), await declarar(qr.id, 100), await conforme(), await cerrarJornada("x".repeat(64), [], "otra")]) expect(r).toMatchObject({ ok: false, codigo: "JORNADA_CERRADA" });
    expect(await foto()).toEqual(antes);
  });
});

describe("repetir sobre la misma jornada: por estado, sin escribir ni auditar de nuevo", () => {
  for (const comando of ["iniciarAuditoria", "cancelarAuditoria", "cerrarJornada"] as const) {
    it(`${comando} dos veces → ${ORACULO_REPETICION[comando].primera} y ${ORACULO_REPETICION[comando].segunda} (${ORACULO_REPETICION[comando].yaEstaba})`, async () => {
      await abrir(0); // la jornada nace
      if (comando === "cancelarAuditoria") await forzarJornada(D, "EN_AUDITORIA");
      const ejecutar = async () => (comando === "iniciarAuditoria" ? iniciar() : comando === "cancelarAuditoria" ? cancelar() : cerrarJornada((await huellaDe()).huella));
      if (comando !== "cancelarAuditoria") {
        // Hay una sesión abierta (BLOQUEA): se cierra para poder empezar el cierre del día.
        expect((await cerrarSesion((await prismaAdmin.sesionCaja.findFirstOrThrow()).id)).ok).toBe(true);
      }
      if (comando === "cerrarJornada") expect((await iniciar()).ok).toBe(true);
      const auditoriaAntes = await prismaAdmin.registroAuditoria.count();
      const a = await ejecutar();
      const auditoriaDespues = await prismaAdmin.registroAuditoria.count();
      const b = await ejecutar();
      expect(unico(a)).toBe(ORACULO_REPETICION[comando].primera);
      expect(unico(b)).toBe(ORACULO_REPETICION[comando].segunda);
      expect(b).toMatchObject({ ok: true, datos: { [ORACULO_REPETICION[comando].yaEstaba]: true } });
      expect(a).toMatchObject({ ok: true, datos: { [ORACULO_REPETICION[comando].yaEstaba]: false } });
      expect(auditoriaDespues - auditoriaAntes, "la primera audita").toBe(1);
      expect(await prismaAdmin.registroAuditoria.count(), "la segunda no audita").toBe(auditoriaDespues);
    });
  }
});

describe("empezar el cierre: lo que impide contar el día", () => {
  it("con la caja abierta no se puede (BLOQUEA); con la caja cerrada sí, y mientras tanto no se abre caja ni se cobra", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const r = await iniciar();
    expect(r).toMatchObject({ ok: false, codigo: "JORNADA_CON_IMPEDIMENTOS", impedimentos: [{ clave: "caja.sesiones_sin_cerrar", cantidad: 1 }] });
    expect((await jornadaDe())?.estado).toBe("ABIERTA");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await iniciar()).ok).toBe(true);
    expect(await jornadaDe()).toMatchObject({ estado: "EN_AUDITORIA", auditoriaIniciadaPorId: s.admin.id });
    expect(await abrir(0)).toMatchObject({ ok: false, codigo: "JORNADA_EN_AUDITORIA" });
    expect((await cancelar()).ok).toBe(true);
    expect(await jornadaDe()).toMatchObject({ estado: "ABIERTA", auditoriaIniciadaEn: null, auditoriaIniciadaPorId: null });
    expect((await abrir(0)).ok).toBe(true);
  });

  it("una cuenta abierta de la sucursal también impide (ventas.cuentas_abiertas BLOQUEA), con su referencia", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    const abierta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    const r = await iniciar();
    expect(r).toMatchObject({ ok: false, codigo: "JORNADA_CON_IMPEDIMENTOS", impedimentos: [{ clave: "ventas.cuentas_abiertas", cantidad: 1, referencias: [abierta.id] }] });
  });

  it("la fecha tiene que ser un día del calendario", async () => {
    for (const mala of ["2026-02-30", "15/01/2026", "", "2026-1-5"]) expect(await iniciar(mala)).toMatchObject({ ok: false, codigo: "FECHA_INVALIDA" });
  });
});

describe("el cierre del día completo, con lo que registra cada pieza", () => {
  it("camino feliz: corregir el medio, declarar el total y cerrar con la foto de los controles; después el día no se toca", async () => {
    const d = await diaCobrado();
    expect(await cantidades()).toMatchObject({ "caja.sesiones_sin_cerrar": 0, "caja.diferencia_de_arqueo": 0, "caja.conciliacion_por_medio": 0, "caja.cobrado_contra_ticket": 0, "caja.cobros_corregidos": 0, "ventas.cuentas_abiertas": 0, "ventas.tickets_por_cobrar": 0 });
    expect((await iniciar()).ok).toBe(true);

    // Corregir el medio: de tarjeta a QR (el cobro original no cambia). QR no tiene registrado ni cierre de caja: SIN_DATO hasta que se declare.
    const qr = await medio("QR");
    const corr = await corregir(d.cobroTarjeta.id, qr.id);
    expect(corr).toMatchObject({ ok: true, datos: { secuencia: 1, yaExistia: false } });
    expect(await prismaAdmin.cobro.findUniqueOrThrow({ where: { id: d.cobroTarjeta.id } })).toMatchObject({ medioDePagoId: d.tarjeta.id });
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 1, "caja.cobros_corregidos": 1 });

    const sinReconocer = await cerrarJornada((await huellaDe()).huella);
    expect(sinReconocer).toMatchObject({ ok: false, codigo: "CONTROLES_SIN_RECONOCER", claves: ["caja.conciliacion_por_medio"] });

    // Declarar lo que dice el comprobante del QR: la diferencia es cero y ya no hay nada que explicar.
    expect(await declarar(qr.id, 3000_00)).toMatchObject({ ok: true, datos: { secuencia: 1 } });
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 0 });
    // El efectivo no se declara.
    expect(await declarar(d.ef, 3100_00)).toMatchObject({ ok: false, codigo: "MEDIO_NO_DECLARABLE" });

    // Una huella vieja no cierra: «lo que se ve es lo que se cierra».
    const vista = await huellaDe();
    const vieja = await cerrarJornada("0".repeat(64));
    expect(vieja).toMatchObject({ ok: false, codigo: "CONTROLES_CAMBIARON", huellaActual: vista.huella });
    expect((await jornadaDe())?.estado).toBe("EN_AUDITORIA");

    const cierre = await cerrarJornada(vista.huella, [], "Dia sin novedades");
    expect(cierre).toMatchObject({ ok: true, datos: { yaEstabaCerrada: false } });
    const j = await jornadaDe();
    expect(j).toMatchObject({ estado: "CERRADA", cerradaPorId: s.admin.id, huellaDeCierre: vista.huella, observacion: "Dia sin novedades" });
    const foto = await prismaAdmin.controlDeJornadaCerrada.findMany({ where: { jornadaId: j?.id }, orderBy: { clave: "asc" } });
    expect(foto.map((f) => [f.clave, f.severidad, f.cantidad, f.reconocido])).toEqual([
      ["caja.ajustes_a_jornadas_cerradas", "INFORMA", 0, false],
      ["caja.cobrado_contra_ticket", "RECONOCIBLE", 0, false],
      ["caja.cobros_corregidos", "INFORMA", 1, false],
      ["caja.conciliacion_por_medio", "RECONOCIBLE", 0, false],
      ["caja.diferencia_de_arqueo", "RECONOCIBLE", 0, false],
      ["caja.sesiones_sin_cerrar", "BLOQUEA", 0, false],
      ["ventas.cuentas_abiertas", "BLOQUEA", 0, false],
      ["ventas.tickets_por_cobrar", "RECONOCIBLE", 0, false],
    ]);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", campo: "estado" } })).toBe(2);

    // Repetir el mismo pedido no escribe; con otra observación es otro cierre.
    expect(await cerrarJornada(vista.huella, [], "Dia sin novedades")).toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
    expect(await cerrarJornada(vista.huella, [], "Otra cosa")).toMatchObject({ ok: false, codigo: "JORNADA_CERRADA" });
    expect(await prismaAdmin.controlDeJornadaCerrada.count()).toBe(8);
    // Y la jornada cerrada es inmutable aunque se intente por SQL.
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "JornadaDeSucursal" SET "observacion" = 'x' WHERE "id" = '${j?.id}'`)).rejects.toThrow(/jornada_cerrada_congelada/);
  });

  it("el conforme general cubre los medios sin declarar (no el efectivo) y una declaración explícita gana sobre él", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 1 });
    expect(await conforme()).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await conforme()).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await prismaAdmin.conformeDeJornada.count()).toBe(1);
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 0 });
    // Declarar un total distinto gana sobre el conforme: queda una diferencia por explicar.
    expect((await declarar(qr.id, 2900_00)).ok).toBe(true);
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 1 });
    // Declarar otra vez toma la secuencia siguiente y rige la última.
    expect(await declarar(qr.id, 3000_00)).toMatchObject({ ok: true, datos: { secuencia: 2 } });
    expect(await cantidades()).toMatchObject({ "caja.conciliacion_por_medio": 0 });
  });

  it("cancelar el cierre: lo corregido y declarado queda y se cuenta en el cierre final; los reconocimientos se vuelven a dar", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const qr = await medio("QR");
    expect((await corregir(d.cobroTarjeta.id, qr.id)).ok).toBe(true);
    expect((await declarar(qr.id, 3000_00)).ok).toBe(true);
    expect((await cancelar()).ok).toBe(true);
    expect(await prismaAdmin.correccionDeMedio.count()).toBe(1);
    expect(await prismaAdmin.declaracionDeTotal.count()).toBe(1);
    // Con la jornada abierta de nuevo no se corrige ni se declara, pero lo hecho sigue contando.
    expect(await corregir(d.cobroTarjeta.id, d.ef)).toMatchObject({ ok: false, codigo: "JORNADA_NO_EN_AUDITORIA" });
    expect(await cantidades()).toMatchObject({ "caja.cobros_corregidos": 1, "caja.conciliacion_por_medio": 0 });
    expect((await iniciar()).ok).toBe(true);
    expect((await cerrarJornada((await huellaDe()).huella)).ok).toBe(true);
  });

  it("corregir el medio: misma clave y mismo pedido es lo mismo; otro pedido con la clave es CLAVE_REUTILIZADA; al mismo medio no cambia nada; el medio inactivo y el que no existe se rechazan", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const qr = await medio("QR");
    const clave = randomUUID();
    const primera = await corregir(d.cobroTarjeta.id, qr.id, clave);
    const segunda = await corregir(d.cobroTarjeta.id, qr.id, clave);
    expect(primera).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await corregir(d.cobroTarjeta.id, d.ef, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await corregir(d.cobroTarjeta.id, qr.id)).toMatchObject({ ok: false, codigo: "MEDIO_DEL_COBRO_SIN_CAMBIOS" });
    expect(await corregir(d.cobroTarjeta.id, (await medio("TARJETA_CREDITO", { activo: false })).id)).toMatchObject({ ok: false, codigo: "MEDIO_NO_HABILITADO" });
    expect(await corregir(d.cobroTarjeta.id, randomUUID())).toMatchObject({ ok: false, codigo: "MEDIO_NO_ENCONTRADO" });
    expect(await corregir(randomUUID(), qr.id)).toMatchObject({ ok: false, codigo: "COBRO_NO_ENCONTRADO" });
    expect(await corregir(d.cobroTarjeta.id, d.ef, randomUUID(), "motivo con <angulos>")).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(await corregir(d.cobroTarjeta.id, d.ef, randomUUID(), "")).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    // Otra corrección parte del medio vigente: de QR a transferencia es la secuencia 2 y «antes» es el QR.
    const tr = await medio("TRANSFERENCIA");
    expect(await corregir(d.cobroTarjeta.id, tr.id)).toMatchObject({ ok: true, datos: { secuencia: 2 } });
    expect((await prismaAdmin.correccionDeMedio.findMany({ orderBy: { secuencia: "asc" } })).map((x) => [x.secuencia, x.medioAntesId, x.medioDespuesId])).toEqual([[1, d.tarjeta.id, qr.id], [2, qr.id, tr.id]]);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CorreccionDeMedio" } })).toBe(2);
  });

  it("el cobro de otra sucursal no se corrige desde esta", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const otra = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA, nombre: "Otra" } });
    const comoOtra = { ...actor(), sucursalId: otra.id, ...baseDeEmpresa(EMPRESA, { lectura: [otra.id], escritura: [otra.id] }) };
    expect(await corregirMedioDeCobroCasoDeUso(comoOtra, { claveIdempotencia: randomUUID(), cobroId: d.cobroTarjeta.id, medioDestinoId: d.ef, motivo: "Prueba" }, azarDelProceso)).toMatchObject({ ok: false, codigo: "COBRO_NO_ENCONTRADO" });
  });
});

describe("controles que mira el cierre: lo cobrado contra el ticket, lo por cobrar y lo que bloquea", () => {
  it("anular un ticket ENTERO ya cobrado deja la plata como diferencia (RECONOCIBLE) y NO la saca de la caja", async () => {
    const d = await diaCobrado();
    const operaciones = (await prismaAdmin.cuentaItem.findMany({ where: { cuentaId: d.c1.id }, select: { operacionId: true } })).flatMap((i) => (i.operacionId ? [i.operacionId] : []));
    expect(operaciones.length).toBeGreaterThan(0);
    // La anulación entera de la venta (la pieza que la hace es otra, fuera de C2): acá solo se la simula, antes del instante «ahora» de la lectura.
    await prismaAdmin.operacion.updateMany({ where: { id: { in: operaciones } }, data: { anuladaEn: new Date("2026-01-15T14:00:00.000Z"), anuladaPorId: s.admin.id } });
    const movimientosAntes = await prismaAdmin.movimientoCaja.count();
    expect(await cantidades()).toMatchObject({ "caja.cobrado_contra_ticket": 1 });
    expect((await iniciar()).ok).toBe(true);
    const sinReconocer = await cerrarJornada((await huellaDe()).huella);
    expect(sinReconocer).toMatchObject({ ok: false, codigo: "CONTROLES_SIN_RECONOCER", claves: ["caja.cobrado_contra_ticket"] });
    // Reconocer algo que no se puede reconocer (un control sin hallazgos, uno que solo informa) es inválido.
    expect(await cerrarJornada((await huellaDe()).huella, [{ clave: "caja.cobrado_contra_ticket", texto: null }, { clave: "caja.cobros_corregidos", texto: null }])).toMatchObject({ ok: false, codigo: "RECONOCIMIENTO_INVALIDO" });
    const ok = await cerrarJornada((await huellaDe()).huella, [{ clave: "caja.cobrado_contra_ticket", texto: "Se anulo el ticket de la mesa 4" }]);
    expect(ok).toMatchObject({ ok: true });
    const foto = await prismaAdmin.controlDeJornadaCerrada.findUniqueOrThrow({ where: { empresaId_jornadaId_clave: { empresaId: EMPRESA, jornadaId: (await jornadaDe())?.id as string, clave: "caja.cobrado_contra_ticket" } } });
    expect(foto).toMatchObject({ reconocido: true, reconocidoPorId: s.admin.id, texto: "Se anulo el ticket de la mesa 4", cantidad: 1 });
    expect(await prismaAdmin.movimientoCaja.count(), "la anulación del ticket no mueve la caja").toBe(movimientosAntes);
  });

  it("un ticket cerrado y sin cobrar de ese día es «por cobrar» (RECONOCIBLE); cobrado, deja de serlo", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const cuenta = await cuentaCerrada();
    // `cerrarCuenta` sella la hora de verdad; para el día de la prueba la cuenta se cerró el 15/01 a las 12:30.
    await prismaAdmin.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date("2026-01-15T15:30:00.000Z") } });
    expect(await cantidades()).toMatchObject({ "ventas.tickets_por_cobrar": 1 });
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await iniciar()).ok).toBe(true);
    expect(await cerrarJornada((await huellaDe()).huella)).toMatchObject({ ok: false, codigo: "CONTROLES_SIN_RECONOCER", claves: ["ventas.tickets_por_cobrar"] });
    expect((await cancelar()).ok).toBe(true);
    expect((await abrir(0)).ok).toBe(true);
    expect((await cobrar(cuenta.id, [{ medioDePagoId: await efectivoId(), importeEnCentavos: c(3000_00) }], 3000_00)).ok).toBe(true);
    expect(await cantidades()).toMatchObject({ "ventas.tickets_por_cobrar": 0 });
  });

  it("una cuenta que se abre DESPUÉS de empezar el cierre cambia los controles: la huella vieja no cierra y la nueva choca con el BLOQUEA", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await iniciar()).ok).toBe(true);
    const vista = await huellaDe();
    await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await cerrarJornada(vista.huella)).toMatchObject({ ok: false, codigo: "CONTROLES_CAMBIARON" });
    expect(await cerrarJornada((await huellaDe()).huella)).toMatchObject({ ok: false, codigo: "CONTROLES_QUE_BLOQUEAN", claves: ["ventas.cuentas_abiertas"] });
    expect((await jornadaDe())?.estado).toBe("EN_AUDITORIA");
  });

  it("una diferencia de arqueo (contado distinto de lo esperado) hay que reconocerla, con su explicación opcional", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId, { 100: 1 }, 50_00)).ok).toBe(true); // esperado 100, contado 150
    expect(await cantidades()).toMatchObject({ "caja.diferencia_de_arqueo": 1 });
    expect((await iniciar()).ok).toBe(true);
    // La misma diferencia aparece en dos controles (como en Pedernal): la de la caja y la conciliación del efectivo del día.
    expect(await cerrarJornada((await huellaDe()).huella)).toMatchObject({ ok: false, codigo: "CONTROLES_SIN_RECONOCER", claves: ["caja.diferencia_de_arqueo", "caja.conciliacion_por_medio"] });
    expect(await cerrarJornada((await huellaDe()).huella, [{ clave: "caja.diferencia_de_arqueo", texto: "x<y" }, { clave: "caja.conciliacion_por_medio", texto: null }])).toMatchObject({ ok: false, codigo: "RECONOCIMIENTO_INVALIDO" });
    expect(await cerrarJornada((await huellaDe()).huella, [{ clave: "caja.diferencia_de_arqueo", texto: "Sobraron 50 pesos" }, { clave: "caja.conciliacion_por_medio", texto: null }])).toMatchObject({ ok: true });
  });

  it("la observación del cierre es de la lista de permitidos", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    expect((await iniciar()).ok).toBe(true);
    for (const mala of ["una\nlinea", "x<y", "a".repeat(501)]) expect(await cerrarJornada((await huellaDe()).huella, [], mala)).toMatchObject({ ok: false, codigo: "OBSERVACION_INVALIDA" });
    expect((await jornadaDe())?.estado).toBe("EN_AUDITORIA");
  });
});

describe("ajuste a una jornada cerrada (oráculo: permiso × sesión × jornada que se corrige), exhaustivo", () => {
  // Fechas de las jornadas que se corrigen, respecto de la de la sesión (D).
  const FECHA: Record<JornadaACorregir, string> = {
    anterior_SIN_ACTIVIDAD: "2026-01-05",
    anterior_ABIERTA: "2026-01-06",
    anterior_EN_AUDITORIA: "2026-01-07",
    anterior_CERRADA: "2026-01-08",
    igual_ABIERTA: D,
    posterior_CERRADA: "2026-01-20",
  };

  async function prepararJornadas() {
    await forzarJornada(FECHA.anterior_ABIERTA, "ABIERTA");
    await forzarJornada(FECHA.anterior_EN_AUDITORIA, "EN_AUDITORIA");
    await forzarJornada(FECHA.anterior_CERRADA, "CERRADA");
    await forzarJornada(FECHA.posterior_CERRADA, "CERRADA");
  }

  for (const f of ORACULO_DE_AJUSTE) {
    it(`${f.puedeAjustar ? "con" : "sin"} permiso, sesión ${f.sesion}, jornada ${f.jornada} → ${f.esperado}`, async () => {
      const a = await abrir(100_00);
      if (!a.ok) throw new Error("no abrió");
      await prepararJornadas();
      if (f.sesion === "CERRADA") expect((await cerrarSesion(a.datos.sesionId, { 100: 1 })).ok).toBe(true);
      const r = await ajustar(a.datos.sesionId, await efectivoId(), -20_00, FECHA[f.jornada], f.puedeAjustar);
      expect(unico(r)).toBe(f.esperado);
      expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "AJUSTE" } })).toBe(f.esperado === "OK" ? 1 : 0);
    });
  }

  it("un ajuste que corrige una jornada cerrada no la cambia: cae en el día en curso, queda enlazado y se informa en el cierre de HOY", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const cerrada = await forzarJornada("2026-01-08", "CERRADA");
    const clave = randomUUID();
    const r = await ajustar(a.datos.sesionId, await efectivoId(), -20_00, "2026-01-08", true, clave);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await ajustar(a.datos.sesionId, await efectivoId(), -20_00, "2026-01-08", true, clave)).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await ajustar(a.datos.sesionId, await efectivoId(), -30_00, "2026-01-08", true, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    const mov = await prismaAdmin.movimientoCaja.findFirstOrThrow({ where: { clase: "AJUSTE" } });
    expect(mov).toMatchObject({ sesionId: a.datos.sesionId, motivo: "Falto un vale" });
    expect(mov.corrigeJornada?.toISOString().slice(0, 10)).toBe("2026-01-08");
    expect(Number(mov.importe)).toBe(-20);
    expect(await jornadaDe("2026-01-08")).toMatchObject({ id: cerrada.id, estado: "CERRADA", huellaDeCierre: "a".repeat(64) });
    expect(await cantidades(D)).toMatchObject({ "caja.ajustes_a_jornadas_cerradas": 1 });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "MovimientoCaja", campo: "ajuste" } })).toBe(1);
    // Un ajuste se anula con su espejo (como un ingreso o un egreso).
    expect(await anularMovimientoCasoDeUso(actor(), { claveIdempotencia: randomUUID(), movimientoId: mov.id, motivo: "Me equivoque" }, true, azarDelProceso)).toMatchObject({ ok: true });
  });

  it("el ajuste común (sin jornada que corregir) puede ser de cualquier medio activo, con signo; el importe cero, sin motivo o con motivo fuera de la lista se rechazan", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const tarjeta = await medio("TARJETA_CREDITO");
    expect(await ajustar(a.datos.sesionId, tarjeta.id, 15_00, null)).toMatchObject({ ok: true });
    expect(await ajustar(a.datos.sesionId, await efectivoId(), -5_00, null)).toMatchObject({ ok: true });
    expect(await ajustar(a.datos.sesionId, tarjeta.id, 0, null)).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO" });
    expect(await ajustar(a.datos.sesionId, tarjeta.id, 1_00, null, true, randomUUID(), "")).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(await ajustar(a.datos.sesionId, tarjeta.id, 1_00, null, true, randomUUID(), "con <html>")).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(await ajustar(a.datos.sesionId, (await medio("QR", { activo: false })).id, 1_00, null)).toMatchObject({ ok: false, codigo: "MEDIO_NO_HABILITADO" });
    expect(await ajustar(randomUUID(), tarjeta.id, 1_00, null)).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await ajustar(a.datos.sesionId, tarjeta.id, 1_00, "2026-02-30")).toMatchObject({ ok: false, codigo: "FECHA_INVALIDA" });
    // El ajuste común entra en lo esperado por medio de la sesión.
    const esperado = (await prismaAdmin.movimientoCaja.groupBy({ by: ["medioDePagoId"], where: { sesionId: a.datos.sesionId }, _sum: { importe: true } })).map((g) => [g.medioDePagoId === tarjeta.id ? "tarjeta" : "efectivo", Number(g._sum.importe)]);
    expect(esperado.sort()).toEqual([["efectivo", 95], ["tarjeta", 15]]);
  });
});

describe("idempotencia y concurrencia (carreras de verdad)", () => {
  it("la misma declaración repetida (misma clave) deja una sola fila; con otro importe es CLAVE_REUTILIZADA", async () => {
    await abrir(0);
    await forzarJornada(D, "EN_AUDITORIA");
    const qr = await medio("QR");
    const clave = randomUUID();
    expect(await declarar(qr.id, 100_00, clave)).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await declarar(qr.id, 100_00, clave)).toMatchObject({ ok: true, datos: { yaExistia: true, secuencia: 1 } });
    expect(await declarar(qr.id, 200_00, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await prismaAdmin.declaracionDeTotal.count()).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "DeclaracionDeTotal" } })).toBe(1);
  });

  it("seis pedidos de declararTotal con la MISMA clave a la vez dejan una sola declaración", async () => {
    await abrir(0);
    await forzarJornada(D, "EN_AUDITORIA");
    const qr = await medio("QR");
    const clave = randomUUID();
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => declararTotalCasoDeUso(actor(), { claveIdempotencia: clave, fechaDeNegocio: D, medioDePagoId: qr.id, importeEnCentavos: c(100_00) }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.declaracionDeTotal.count()).toBe(1);
  });

  it("cuatro pedidos de declararTotal con claves DISTINTAS a la vez toman las secuencias 1 a 4 sin huecos y rige la última", async () => {
    await abrir(0);
    await forzarJornada(D, "EN_AUDITORIA");
    const qr = await medio("QR");
    const rs = await Promise.allSettled([100, 200, 300, 400].map((n) => declararTotalCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fechaDeNegocio: D, medioDePagoId: qr.id, importeEnCentavos: c(n * 100) }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect((await prismaAdmin.declaracionDeTotal.findMany({ orderBy: { secuencia: "asc" } })).map((x) => x.secuencia)).toEqual([1, 2, 3, 4]);
  });

  it("seis darConformeGeneral a la vez con claves distintas dejan UN solo conforme y todos responden bien", async () => {
    await abrir(0);
    await forzarJornada(D, "EN_AUDITORIA");
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => darConformeGeneralCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fechaDeNegocio: D }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && !x.value.datos.yaExistia)).toHaveLength(1);
    expect(await prismaAdmin.conformeDeJornada.count()).toBe(1);
  });

  it("seis corregirMedioDeCobro a la vez del MISMO cobro con claves distintas dejan UNA corrección (las otras ven que el medio cambió)", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const qr = await medio("QR");
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => corregirMedioDeCobroCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cobroId: d.cobroTarjeta.id, medioDestinoId: qr.id, motivo: "Equivocado" }, azarDelProceso)));
    const resultados = rs.map((x) => (x.status === "fulfilled" ? unico(x.value) : "RECHAZADA"));
    expect(resultados.filter((r) => r === "OK")).toHaveLength(1);
    expect(resultados.every((r) => r === "OK" || r === "MEDIO_DEL_COBRO_CAMBIO" || r === "MEDIO_DEL_COBRO_SIN_CAMBIOS"), JSON.stringify(resultados)).toBe(true);
    expect(await prismaAdmin.correccionDeMedio.count()).toBe(1);
  });

  it("seis corregirMedioDeCobro con la MISMA clave a la vez dejan una sola corrección y todos responden lo mismo", async () => {
    const d = await diaCobrado();
    expect((await iniciar()).ok).toBe(true);
    const qr = await medio("QR");
    const clave = randomUUID();
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => corregirMedioDeCobroCasoDeUso(actor(), { claveIdempotencia: clave, cobroId: d.cobroTarjeta.id, medioDestinoId: qr.id, motivo: "Equivocado" }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.correccionDeMedio.count()).toBe(1);
  });

  it("seis registrarAjuste a la vez con la MISMA clave dejan un solo ajuste y todos responden bien", async () => {
    const a = await abrir(100_00);
    if (!a.ok) throw new Error("no abrió");
    const clave = randomUUID();
    const ef = await efectivoId();
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => registrarAjusteCasoDeUso(actor(), { claveIdempotencia: clave, sesionId: a.datos.sesionId, medioDePagoId: ef, importeEnCentavos: c(-10_00), motivo: "Falto un vale", corrigeJornada: null }, true, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "AJUSTE" } })).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "MovimientoCaja", campo: "ajuste" } })).toBe(1);
  });

  it("ocho iniciarAuditoria a la vez cambian el estado UNA vez (las otras ven que ya estaba) y auditan una sola vez", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    expect((await cerrarSesion(a.datos.sesionId)).ok).toBe(true);
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => iniciarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: D })));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && !x.value.datos.yaEstabaEnAuditoria)).toHaveLength(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", valorNuevo: "EN_AUDITORIA" } })).toBe(1);
  });

  it("seis cerrarJornada a la vez cierran UNA vez: una foto de ocho controles, una auditoría y todas las respuestas buenas", async () => {
    const d = await diaCobrado();
    expect(d.sesionId).toBeTruthy();
    expect((await iniciar()).ok).toBe(true);
    const huella = (await huellaDe()).huella;
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => cerrarJornadaCasoDeUso(actor(), { fechaDeNegocio: D, huellaVista: huella, reconocimientos: [{ clave: "caja.conciliacion_por_medio", texto: null }].filter(() => false), observacion: null }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok), JSON.stringify(rs.map((x) => (x.status === "fulfilled" ? unico(x.value) : "RECHAZADA")))).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && !x.value.datos.yaEstabaCerrada)).toHaveLength(1);
    expect(await prismaAdmin.controlDeJornadaCerrada.count()).toBe(8);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", campo: "estado", valorAnterior: "EN_AUDITORIA" } })).toBe(1);
  });

  it("empezar el cierre contra cerrar la caja a la vez: nunca queda la jornada en cierre con una caja abierta", async () => {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await limpiarBaseDeTest();
      s = await sembrarSalon();
      await entrarComo(s.admin);
      const a = await abrir(0);
      if (!a.ok) throw new Error("no abrió");
      await Promise.allSettled([iniciarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: D }), cerrarSesionCasoDeUso(actor(), { sesionId: a.datos.sesionId, conteo: { billetes: {}, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: false, observacion: null }, azarDelProceso)]);
      const j = await jornadaDe();
      const sesion = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: a.datos.sesionId } });
      if (j?.estado === "EN_AUDITORIA") expect(sesion.estado, `vuelta ${vuelta}`).toBe("CERRADA");
      else expect(j?.estado).toBe("ABIERTA");
    }
  });

  it("abrir caja contra empezar el cierre a la vez: o la caja se abre y el cierre ve el impedimento, o el cierre empieza y no se abre caja", async () => {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await limpiarBaseDeTest();
      s = await sembrarSalon();
      await entrarComo(s.admin);
      const previa = await abrir(0);
      if (!previa.ok) throw new Error("no abrió");
      expect((await cerrarSesion(previa.datos.sesionId)).ok).toBe(true);
      await Promise.allSettled([abrirSesionCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fondoEnCentavos: c(0) }, azarDelProceso), iniciarAuditoriaCasoDeUso(actor(), { fechaDeNegocio: D })]);
      const j = await jornadaDe();
      const abiertas = await prismaAdmin.sesionCaja.count({ where: { estado: "ABIERTA" } });
      if (j?.estado === "EN_AUDITORIA") expect(abiertas, `vuelta ${vuelta}`).toBe(0);
    }
  });
});

describe("la base hace cumplir lo que el caso de uso no puede olvidar (C2)", () => {
  const jornadaConMarcas = (estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA") => ({
    estado,
    ...(estado === "ABIERTA" ? { auditoriaIniciadaEn: null, auditoriaIniciadaPorId: null, cerradaEn: null, cerradaPorId: null, huellaDeCierre: null } : {}),
    ...(estado === "EN_AUDITORIA" ? { auditoriaIniciadaEn: AHORA, auditoriaIniciadaPorId: s.admin.id, cerradaEn: null, cerradaPorId: null, huellaDeCierre: null } : {}),
    ...(estado === "CERRADA" ? { auditoriaIniciadaEn: AHORA, auditoriaIniciadaPorId: s.admin.id, cerradaEn: AHORA, cerradaPorId: s.admin.id, huellaDeCierre: "b".repeat(64) } : {}),
  });

  it("las transiciones de estado: las nueve combinaciones coinciden con el núcleo (solo tres valen)", async () => {
    const { TRANSICIONES_DE_JORNADA, ESTADOS_DE_JORNADA } = await import("../../src/core/caja/public");
    let n = 0;
    for (const desde of ESTADOS_DE_JORNADA) {
      for (const hacia of ESTADOS_DE_JORNADA) {
        n += 1;
        const fecha = `2026-02-${String(n).padStart(2, "0")}`;
        const j = await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: col(fecha), ...(jornadaConMarcas(desde) as object) } });
        const intento = prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: jornadaConMarcas(hacia) as never });
        if (TRANSICIONES_DE_JORNADA[desde].includes(hacia)) await expect(intento, `${desde} → ${hacia}`).resolves.toBeTruthy();
        else await expect(intento, `${desde} → ${hacia}`).rejects.toThrow(/jornada_/);
      }
    }
  });

  it("la identidad de la jornada no se cambia y una jornada no se crea cerrada ni con marcas incoherentes", async () => {
    const j = await forzarJornada(D, "ABIERTA");
    await expect(prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { fechaDeNegocio: col("2026-01-16") } })).rejects.toThrow(/jornada_identidad_inmutable/);
    await expect(prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: col("2026-03-01"), estado: "CERRADA" } })).rejects.toThrow(/JornadaDeSucursal_marcas_chk/);
    await expect(prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: col(D) } })).rejects.toThrow(/JornadaDeSucursal_una_por_dia_key|Unique constraint/);
  });

  it("la foto de controles no se puede sembrar con la jornada abierta, ni agregar a una jornada cerrada de antes", async () => {
    const abierta = await forzarJornada(D, "ABIERTA");
    const control = (jornadaId: string) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId, modulo: "caja", clave: "caja.sesiones_sin_cerrar", severidad: "BLOQUEA", cantidad: 0, reconocido: false });
    await expect(prismaAdmin.controlDeJornadaCerrada.create({ data: control(abierta.id) })).rejects.toThrow(/control_solo_al_cerrar_la_jornada/);
    const cerrada = await forzarJornada("2026-01-10", "CERRADA");
    await expect(prismaAdmin.controlDeJornadaCerrada.create({ data: control(cerrada.id) })).rejects.toThrow(/control_solo_al_cerrar_la_jornada/);
  });

  it("el sello de la sesión: zona, hora de corte y fecha de negocio tienen que ser los vigentes, y la jornada, abierta", async () => {
    const caja = await prismaAdmin.caja.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, nombre: "Caja 1" } });
    const sesion = (extra: Record<string, unknown>) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, cajaId: caja.id, estado: "ABIERTA", fechaDeNegocio: col(D), zonaHoraria: ZONA, horaDeCorte: new Date("1970-01-01T00:00:00.000Z"), abiertaEn: AHORA, abiertaPorId: s.admin.id, claveIdempotencia: randomUUID(), huella: "c".repeat(64), ...extra });
    const j = await forzarJornada(D, "ABIERTA");
    await expect(prismaAdmin.sesionCaja.create({ data: sesion({ fechaDeNegocio: col("2026-01-14") }) as never })).rejects.toThrow(/sesion_caja_fecha_de_negocio_invalida/);
    await expect(prismaAdmin.sesionCaja.create({ data: sesion({ horaDeCorte: new Date("1970-01-01T06:00:00.000Z") }) as never })).rejects.toThrow(/sesion_caja_sello_invalido/);
    await expect(prismaAdmin.sesionCaja.create({ data: sesion({ zonaHoraria: "UTC" }) as never })).rejects.toThrow(/sesion_caja_sello_invalido/);
    await forzarJornada(D, "EN_AUDITORIA");
    await expect(prismaAdmin.sesionCaja.create({ data: sesion({}) as never })).rejects.toThrow(/sesion_caja_jornada_no_abierta/);
    expect(j.estado).toBe("ABIERTA");
  });

  it("un movimiento no entra con la jornada de su sesión en cierre; la declaración no es del efectivo, la secuencia no tiene huecos y la corrección parte del medio vigente", async () => {
    const a = await abrir(0);
    if (!a.ok) throw new Error("no abrió");
    const ef = await efectivoId();
    const j = await forzarJornada(D, "EN_AUDITORIA");
    const movimiento = { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, sesionId: a.datos.sesionId, clase: "INGRESO_MANUAL", medioDePagoId: ef, importe: "5.00", motivo: "x", creadoPorId: s.admin.id };
    await expect(prismaAdmin.movimientoCaja.create({ data: movimiento as never })).rejects.toThrow(/movimiento_caja_jornada_no_abierta/);
    const qr = await medio("QR");
    const declaracion = (extra: Record<string, unknown>) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId: j.id, medioDePagoId: qr.id, secuencia: 1, importe: "10.00", declaradoEn: AHORA, declaradoPorId: s.admin.id, claveIdempotencia: randomUUID(), huella: "d".repeat(64), ...extra });
    await expect(prismaAdmin.declaracionDeTotal.create({ data: declaracion({ medioDePagoId: ef }) as never })).rejects.toThrow(/el_efectivo_no_se_declara/);
    await expect(prismaAdmin.declaracionDeTotal.create({ data: declaracion({ secuencia: 2 }) as never })).rejects.toThrow(/declaracion_secuencia_con_huecos/);
    await expect(prismaAdmin.declaracionDeTotal.create({ data: declaracion({ importe: "-1.00" }) as never })).rejects.toThrow(/DeclaracionDeTotal_importe_chk/);
    await expect(prismaAdmin.declaracionDeTotal.create({ data: declaracion({}) as never })).resolves.toBeTruthy();
    await forzarJornada(D, "ABIERTA").catch(() => undefined);
  });

  it("una corrección no entra con la jornada abierta, ni con un «antes» que no es el vigente, ni con un motivo fuera de la lista", async () => {
    const d = await diaCobrado();
    const j = (await jornadaDe()) as NonNullable<Awaited<ReturnType<typeof jornadaDe>>>;
    const qr = await medio("QR");
    const fila = (extra: Record<string, unknown>) => ({ id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, jornadaId: j.id, cobroId: d.cobroTarjeta.id, secuencia: 1, medioAntesId: d.tarjeta.id, medioDespuesId: qr.id, motivo: "Prueba", corregidoEn: AHORA, corregidoPorId: s.admin.id, claveIdempotencia: randomUUID(), huella: "e".repeat(64), ...extra });
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({}) as never })).rejects.toThrow(/jornada_no_esta_en_en_auditoria/);
    await forzarJornada(D, "EN_AUDITORIA");
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({ medioAntesId: d.ef }) as never })).rejects.toThrow(/correccion_antes_no_es_el_vigente/);
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({ secuencia: 2 }) as never })).rejects.toThrow(/correccion_secuencia_con_huecos/);
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({ motivo: "<script>" }) as never })).rejects.toThrow(/CorreccionDeMedio_motivo_chk/);
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({ medioDespuesId: d.tarjeta.id }) as never })).rejects.toThrow(/CorreccionDeMedio_cambia_chk/);
    await expect(prismaAdmin.correccionDeMedio.create({ data: fila({}) as never })).resolves.toBeTruthy();
  });
});
