import { guardDeId } from "./guard-de-id";
import type { ComandoCerrarCuenta, ComandoEmitirTicketCorregido } from "./cuenta.schema";

/**
 * Guard de la feature Cuenta del salón (convención "guard por feature", 2026-09-25; Task #41, Fase M). Formato del comando, ANTES de
 * abrir la transacción. Puro: sin Prisma ni permisos.
 */

/** El texto que ya usaban las acciones de «tomar pedido» para una cuenta que no es de la sucursal activa (o no existe). */
export const MENSAJE_CUENTA_NO_ENCONTRADA = "No se encontró esa cuenta en esta sucursal.";

/**
 * Guard del comando «cerrar la cuenta». Solo el `cuentaId`: si no es un string, el MISMO mensaje que «no encontrada» — exactamente lo
 * que ya respondía `cerrarCuenta` (que con un id no-string salteaba el `findFirst` y devolvía ese error). Un string —exista o no— pasa
 * tal cual, y el caso de uso sigue respondiendo como siempre.
 */
export const guardComandoCerrarCuenta = guardDeId<ComandoCerrarCuenta>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA);

/**
 * Guard del comando «emitir ticket corregido» (M12b). Solo el `cuentaId`, con el mismo criterio que `guardComandoCerrarCuenta`: si no es
 * un string, «no encontrada» (lo que ya respondía `emitirTicketCorregido`, que salteaba el `findFirst`). El `motivo` pasa TAL CUAL, sin
 * validar: `validarMotivoAnulacion` corre en el caso de uso, después de las guardas de estado (así un motivo vacío sobre un ticket vigente
 * sigue respondiendo «ya refleja las anulaciones», como antes).
 */
export const guardComandoEmitirTicketCorregido = guardDeId<ComandoEmitirTicketCorregido>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA, "motivo");
