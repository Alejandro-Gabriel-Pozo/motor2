import { guardDeId } from "./guard-de-id";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esClaveIdempotenciaValida, MENSAJE_CLAVE_DE_REINTENTO_INVALIDA } from "@/core/datos/clave-idempotencia";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import { LARGO_MAXIMO_MOTIVO_ANULACION, texto } from "@/core/texto";
import type { ComandoCerrarCuenta, ComandoCorregirLineaDeTicket, ComandoEmitirTicketCorregido, ComandoQuitarUnidadesDeLinea } from "./cuenta.schema";

/**
 * Guard de la feature Cuenta del salón (convención "guard por feature"). Formato del comando, ANTES de
 * abrir la transacción. Puro: sin Prisma ni permisos.
 */

/** El texto que usan las acciones de «tomar pedido» para una cuenta que no es de la sucursal activa (o no existe). */
export const MENSAJE_CUENTA_NO_ENCONTRADA = "No se encontró esa cuenta en esta sucursal.";

/**
 * Guard del comando «cerrar la cuenta». Solo el `cuentaId`: si no es un string, el MISMO mensaje que «no encontrada» (con un id no-string
 * no se lee la base). Un string —exista o no— pasa
 * tal cual, y el caso de uso sigue respondiendo como siempre.
 */
export const guardComandoCerrarCuenta = guardDeId<ComandoCerrarCuenta>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA);

/**
 * Guard del comando «emitir ticket corregido». Solo el `cuentaId`, con el mismo criterio que `guardComandoCerrarCuenta`: si no es
 * un string, «no encontrada» (sin leer la base). El `motivo` pasa TAL CUAL, sin
 * validar: `validarMotivoAnulacion` corre en el caso de uso, después de las guardas de estado (así un motivo vacío sobre un ticket vigente
 * sigue respondiendo «ya refleja las anulaciones», como antes).
 */
export const guardComandoEmitirTicketCorregido = guardDeId<ComandoEmitirTicketCorregido>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA, "motivo");

/**
 * Guard del comando «corregir una línea de una cuenta cerrada» (E0 de la corrección por ajuste). Formato, ANTES de abrir la transacción:
 * `cuentaId` y `operacionId` textos (si no, «no encontrada»), clave I3 OBLIGATORIA (un doble clic no puede corregir dos veces), motivo obligatorio de 1 a 200
 * caracteres, y lo que la persona vio (`ejemplarVisto` entero positivo, `totalVisto` número finito no negativo).
 */
export function guardComandoCorregirLineaDeTicket(entrada: unknown): ResultadoDato<ComandoCorregirLineaDeTicket> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoCorregirLineaDeTicket, unknown>>;
  if (typeof e.cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  if (typeof e.operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  if (e.claveIdempotencia === undefined || e.claveIdempotencia === null || e.claveIdempotencia === "") return rechazar("vacio", "Falta la clave de reintento: recargá la pantalla.");
  if (!esClaveIdempotenciaValida(e.claveIdempotencia)) return rechazar("formato", MENSAJE_CLAVE_DE_REINTENTO_INVALIDA);
  // El motivo, con los mismos textos que `validarMotivoAnulacion` (core/pos/cuenta.ts, que emite el ticket): obligatorio, hasta 200 caracteres.
  const motivoTexto = typeof e.motivo === "string" ? texto(e.motivo) : "";
  if (!motivoTexto) return rechazar("vacio", "Escribí el motivo de la anulación.");
  if (motivoTexto.length > LARGO_MAXIMO_MOTIVO_ANULACION) return rechazar("largo", `El motivo no puede superar los ${LARGO_MAXIMO_MOTIVO_ANULACION} caracteres.`);
  if (typeof e.ejemplarVisto !== "number" || !Number.isInteger(e.ejemplarVisto) || e.ejemplarVisto < 1) return rechazar("formato", "Recargá la pantalla: no se pudo leer el ticket que estabas viendo.");
  if (typeof e.totalVisto !== "number" || !Number.isFinite(e.totalVisto) || e.totalVisto < 0) return rechazar("formato", "Recargá la pantalla: no se pudo leer el total que estabas viendo.");
  return aceptar({
    cuentaId: e.cuentaId,
    operacionId: e.operacionId,
    motivo: motivoTexto,
    ejemplarVisto: e.ejemplarVisto,
    totalVisto: e.totalVisto,
    claveIdempotencia: e.claveIdempotencia,
  });
}

/**
 * Guard del comando «quitar unidades de una línea» (E1 de la corrección por ajuste). Formato, ANTES de abrir la transacción: lo de `guardComandoCorregirLineaDeTicket`
 * (ids, clave I3 obligatoria, motivo de 1 a 200 caracteres, ejemplar y total vistos) más `unidadesAQuitar` y `unidadesVistas`, enteros positivos. Si las unidades a quitar
 * superan las vistas lo decide la regla pura (`UNIDADES_INVALIDAS`), no el formato.
 */
export function guardComandoQuitarUnidadesDeLinea(entrada: unknown): ResultadoDato<ComandoQuitarUnidadesDeLinea> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoQuitarUnidadesDeLinea, unknown>>;
  const base = guardComandoCorregirLineaDeTicket(entrada);
  if (!base.ok) return base;
  const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
  if (!entero(e.unidadesAQuitar)) return rechazar("formato", "Las unidades a quitar tienen que ser un número entero de 1 en adelante.");
  if (!entero(e.unidadesVistas)) return rechazar("formato", "Recargá la pantalla: no se pudo leer cuántas unidades tenía la línea.");
  return aceptar({ ...base.valor, unidadesAQuitar: e.unidadesAQuitar, unidadesVistas: e.unidadesVistas });
}
