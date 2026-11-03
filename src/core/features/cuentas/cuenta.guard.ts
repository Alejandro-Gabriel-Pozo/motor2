import { guardDeId } from "./guard-de-id";
import type { ComandoCerrarCuenta, ComandoEmitirTicketCorregido } from "./cuenta.schema";

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
