import { DENOMINACIONES_DE_BILLETE, MAXIMO_DE_RENGLONES_DE_COBRO, centavosDeTexto, type ConteoDeBilletes, type RenglonDeCobro } from "@/core/caja/public";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { textoDeUnaLineaDesdeTexto } from "@/core/datos/texto-de-catalogo";
import type {
  ComandoAbrirSesion,
  ComandoAnularMovimiento,
  ComandoCerrarSesion,
  ComandoCobrarCuenta,
  ComandoMovimientoManual,
  EntradaDeAbrirSesion,
  EntradaDeAnularMovimiento,
  EntradaDeCerrarSesion,
  EntradaDeCobrarCuenta,
  EntradaDeMovimientoManual,
} from "./caja.schema";

/**
 * Guards de la feature «caja» (etapa C1, PR-B; convención «guard por feature»): el FORMATO de cada comando ANTES de tocar la base. Los llama la Server Action DENTRO de su `conPermiso(…)`: el rechazo por permiso llega antes que el de formato.
 * Puros: sin reloj, sin azar, sin I/O. Todo por LISTA DE PERMITIDOS (regla «todo nace cerrado», 2026-11-11): cada dato declara lo que SE ACEPTA (forma, largo, conjunto) y lo demás se rechaza, incluido lo que no sea del tipo esperado
 * (el navegador puede mandar cualquier cosa). El rechazo es un CÓDIGO estable (la pantalla lo traduce a texto; `campo` dice cuál dato, p. ej. `renglones.2.importe`).
 *  · Ids de la caja (sesión, movimiento, medio de pago) y clave de reintento: UUID. El id de una cuenta es el de `Cuenta` (texto de letras, dígitos, `_` y `-`, hasta 64).
 *  · Importes: TEXTO decimal («1234.56», a lo sumo 2 decimales, sin signo ni separador de miles), menor que el tope de la columna; pasan a centavos enteros sin `number`. Mayor que cero, salvo el fondo y las monedas, que admiten 0.
 *  · Motivo y observación: una línea de 1 a 500 caracteres con la lista de permitidos de los textos del proyecto (`textoDeUnaLineaDesdeTexto`, con signos de catálogo) y al menos una letra.
 *  · Conteo: solo las denominaciones de la planilla, cantidades enteras de 0 a 99999.
 */
export type CodigoDeRechazoDeGuardDeCaja =
  | "ENTRADA_INVALIDA"
  | "CLAVE_INVALIDA"
  | "IDENTIFICADOR_INVALIDO"
  | "IMPORTE_INVALIDO"
  | "SENTIDO_INVALIDO"
  | "MOTIVO_INVALIDO"
  | "OBSERVACION_INVALIDA"
  | "RENGLONES_INVALIDOS"
  | "CONTEO_INVALIDO"
  | "CONFORME_INVALIDO";
export type RechazoDeGuardDeCaja = { ok: false; codigo: CodigoDeRechazoDeGuardDeCaja; campo: string };
export type ResultadoDeGuardDeCaja<T> = { ok: true; valor: T } | RechazoDeGuardDeCaja;

const rechazo = (codigo: CodigoDeRechazoDeGuardDeCaja, campo: string): RechazoDeGuardDeCaja => ({ ok: false, codigo, campo });

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGEX_ID_DE_CUENTA = /^[A-Za-z0-9_-]{1,64}$/;
const LARGO_MAXIMO_DEL_MOTIVO = 500;
const MAXIMO_DE_BILLETES_POR_DENOMINACION = 99999;

const esUuid = (valor: unknown): valor is string => typeof valor === "string" && REGEX_UUID.test(valor);
const esIdDeCuenta = (valor: unknown): valor is string => typeof valor === "string" && REGEX_ID_DE_CUENTA.test(valor);
const esObjetoPlano = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Un texto libre de una línea (1 a 500): su forma canónica, o `null` si no pasa la lista de permitidos. */
function textoLibre(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const r = textoDeUnaLineaDesdeTexto(valor, { maximo: LARGO_MAXIMO_DEL_MOTIVO, exigirUnaLetra: true, conSignosDeCatalogo: true });
  return r.ok ? r.valor : null;
}

/** Un importe en texto a centavos; `permitirCero` solo para el fondo y las monedas. `null` si no vale. */
function importeEnCentavos(valor: unknown, permitirCero: boolean): bigint | null {
  const centavos = centavosDeTexto(valor);
  if (centavos === null) return null;
  return centavos === BigInt(0) && !permitirCero ? null : centavos;
}

/** «Abrir la caja»: la clave de reintento y el fondo inicial (admite 0). */
export function guardComandoAbrirSesion(entrada: EntradaDeAbrirSesion): ResultadoDeGuardDeCaja<ComandoAbrirSesion> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esClaveIdempotenciaValida(entrada.claveIdempotencia)) return rechazo("CLAVE_INVALIDA", "claveIdempotencia");
  const fondo = importeEnCentavos(entrada.fondo, true);
  if (fondo === null) return rechazo("IMPORTE_INVALIDO", "fondo");
  return { ok: true, valor: { claveIdempotencia: entrada.claveIdempotencia, fondoEnCentavos: fondo } };
}

/** «Ingreso o egreso manual de efectivo»: clave, sesión, sentido, importe (mayor que cero) y motivo. */
export function guardComandoMovimientoManual(entrada: EntradaDeMovimientoManual): ResultadoDeGuardDeCaja<ComandoMovimientoManual> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esClaveIdempotenciaValida(entrada.claveIdempotencia)) return rechazo("CLAVE_INVALIDA", "claveIdempotencia");
  if (!esUuid(entrada.sesionId)) return rechazo("IDENTIFICADOR_INVALIDO", "sesionId");
  if (entrada.sentido !== "INGRESO" && entrada.sentido !== "EGRESO") return rechazo("SENTIDO_INVALIDO", "sentido");
  const importe = importeEnCentavos(entrada.importe, false);
  if (importe === null) return rechazo("IMPORTE_INVALIDO", "importe");
  const motivo = textoLibre(entrada.motivo);
  if (motivo === null) return rechazo("MOTIVO_INVALIDO", "motivo");
  return { ok: true, valor: { claveIdempotencia: entrada.claveIdempotencia, sesionId: entrada.sesionId, sentido: entrada.sentido, importeEnCentavos: importe, motivo } };
}

/** «Anular un movimiento manual»: clave, movimiento y motivo. */
export function guardComandoAnularMovimiento(entrada: EntradaDeAnularMovimiento): ResultadoDeGuardDeCaja<ComandoAnularMovimiento> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esClaveIdempotenciaValida(entrada.claveIdempotencia)) return rechazo("CLAVE_INVALIDA", "claveIdempotencia");
  if (!esUuid(entrada.movimientoId)) return rechazo("IDENTIFICADOR_INVALIDO", "movimientoId");
  const motivo = textoLibre(entrada.motivo);
  if (motivo === null) return rechazo("MOTIVO_INVALIDO", "motivo");
  return { ok: true, valor: { claveIdempotencia: entrada.claveIdempotencia, movimientoId: entrada.movimientoId, motivo } };
}

/**
 * «Cobrar una cuenta»: clave, cuenta, el total que vio quien cobra (mayor que cero) y los renglones (medio e importe, mayor que cero cada uno; hasta `MAXIMO_DE_RENGLONES_DE_COBRO`). Que la lista esté vacía o que la suma no dé el total
 * lo juzga el caso de uso con su código (`COBRO_SIN_RENGLONES`, `COBRO_NO_CUADRA`): acá solo la forma.
 */
export function guardComandoCobrarCuenta(entrada: EntradaDeCobrarCuenta): ResultadoDeGuardDeCaja<ComandoCobrarCuenta> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esClaveIdempotenciaValida(entrada.claveIdempotencia)) return rechazo("CLAVE_INVALIDA", "claveIdempotencia");
  if (!esIdDeCuenta(entrada.cuentaId)) return rechazo("IDENTIFICADOR_INVALIDO", "cuentaId");
  const total = importeEnCentavos(entrada.totalVisto, false);
  if (total === null) return rechazo("IMPORTE_INVALIDO", "totalVisto");
  if (!Array.isArray(entrada.renglones) || entrada.renglones.length > MAXIMO_DE_RENGLONES_DE_COBRO) return rechazo("RENGLONES_INVALIDOS", "renglones");
  const renglones: RenglonDeCobro[] = [];
  for (const [i, r] of (entrada.renglones as readonly unknown[]).entries()) {
    if (!esObjetoPlano(r)) return rechazo("RENGLONES_INVALIDOS", `renglones.${i}`);
    if (!esUuid(r.medioDePagoId)) return rechazo("IDENTIFICADOR_INVALIDO", `renglones.${i}.medioDePagoId`);
    const importe = importeEnCentavos(r.importe, false);
    if (importe === null) return rechazo("IMPORTE_INVALIDO", `renglones.${i}.importe`);
    renglones.push({ medioDePagoId: r.medioDePagoId, importeEnCentavos: importe });
  }
  return { ok: true, valor: { claveIdempotencia: entrada.claveIdempotencia, cuentaId: entrada.cuentaId, totalVistoEnCentavos: total, renglones } };
}

/** El conteo de billetes: solo las denominaciones de la planilla, cantidades enteras de 0 a 99999. */
function conteoDeBilletes(billetes: unknown, monedas: unknown): ConteoDeBilletes | null {
  if (!esObjetoPlano(billetes)) return null;
  const permitidas = new Set<string>(DENOMINACIONES_DE_BILLETE.map(String));
  const cantidades: Partial<Record<(typeof DENOMINACIONES_DE_BILLETE)[number], number>> = {};
  for (const [denominacion, cantidad] of Object.entries(billetes)) {
    if (!permitidas.has(denominacion)) return null;
    if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAXIMO_DE_BILLETES_POR_DENOMINACION) return null;
    cantidades[Number(denominacion) as (typeof DENOMINACIONES_DE_BILLETE)[number]] = cantidad;
  }
  const centavosDeMonedas = importeEnCentavos(monedas, true);
  return centavosDeMonedas === null ? null : { billetes: cantidades, monedasEnCentavos: centavosDeMonedas };
}

/** «Cerrar la caja con arqueo»: la sesión, el conteo (billetes y monedas), el «conforme» de los demás medios (booleano) y la observación (opcional, 1 a 500). */
export function guardComandoCerrarSesion(entrada: EntradaDeCerrarSesion): ResultadoDeGuardDeCaja<ComandoCerrarSesion> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esUuid(entrada.sesionId)) return rechazo("IDENTIFICADOR_INVALIDO", "sesionId");
  const conteo = conteoDeBilletes(entrada.billetes, entrada.monedas);
  if (conteo === null) return rechazo("CONTEO_INVALIDO", "conteo");
  if (typeof entrada.conformeDeLosDemasMedios !== "boolean") return rechazo("CONFORME_INVALIDO", "conformeDeLosDemasMedios");
  let observacion: string | null = null;
  if (entrada.observacion !== null && entrada.observacion !== undefined) {
    observacion = textoLibre(entrada.observacion);
    if (observacion === null) return rechazo("OBSERVACION_INVALIDA", "observacion");
  }
  return { ok: true, valor: { sesionId: entrada.sesionId, conteo, conformeDeLosDemasMedios: entrada.conformeDeLosDemasMedios, observacion } };
}
