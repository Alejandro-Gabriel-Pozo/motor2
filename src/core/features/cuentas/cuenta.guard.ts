import { guardDeId } from "./guard-de-id";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esClaveIdempotenciaValida, MENSAJE_CLAVE_DE_REINTENTO_INVALIDA } from "@/core/datos/clave-idempotencia";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import { validarMotivoAnulacion } from "@/core/pos/cuenta";
import type { ComandoCerrarCuenta, ComandoCorregirLineaDeTicket, ComandoEmitirTicketCorregido } from "./cuenta.schema";

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
  const motivo = validarMotivoAnulacion(e.motivo);
  if (!motivo.ok) return rechazar("vacio", motivo.mensaje);
  if (typeof e.ejemplarVisto !== "number" || !Number.isInteger(e.ejemplarVisto) || e.ejemplarVisto < 1) return rechazar("formato", "Recargá la pantalla: no se pudo leer el ticket que estabas viendo.");
  if (typeof e.totalVisto !== "number" || !Number.isFinite(e.totalVisto) || e.totalVisto < 0) return rechazar("formato", "Recargá la pantalla: no se pudo leer el total que estabas viendo.");
  return aceptar({
    cuentaId: e.cuentaId,
    operacionId: e.operacionId,
    motivo: motivo.motivo,
    ejemplarVisto: e.ejemplarVisto,
    totalVisto: e.totalVisto,
    claveIdempotencia: e.claveIdempotencia,
  });
}
