import { guardDeId } from "./guard-de-id";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "./cuenta.guard";
import type { ComandoAbrirCuenta, ComandoAsignarClienteACuenta, ComandoCorregirComensales, ComandoLiberarMesa } from "./cuenta-apertura.schema";

/**
 * Guard de la APERTURA de la cuenta de una mesa (feature Cuenta del salón; convención «guard por feature»). Formato del comando, ANTES de
 * abrir la transacción, llamado por la Server Action DENTRO de su `conPermiso(…)`. Puro: sin Prisma ni permisos.
 *
 * Solo miran que el id sea un TEXTO: si no lo es, devuelven el MISMO mensaje que «no encontrado», (con un id
 * que no es texto, `cuentaAbiertaDeSucursal` salteaba la lectura y devolvía ese error). Todo lo demás (comensales, cliente) lo sigue validando el caso de uso
 * en el lugar de siempre: un guard que lo adelantara cambiaría qué mensaje gana cuando hay dos fallas a la vez (lo fija `huella-del-pos`).
 */

/** El texto de `abrirCuenta` para una mesa que no es de la sucursal activa (o no existe, o un id que no es texto). */
export const MENSAJE_MESA_NO_ENCONTRADA = "No se encontró esa mesa en esta sucursal.";

/** Guard del comando «abrir la cuenta de una mesa»: los `comensales` pasan TAL CUAL (los valida el caso de uso después de mirar si la mesa ya estaba abierta). */
export const guardComandoAbrirCuenta = guardDeId<ComandoAbrirCuenta>("mesaId", MENSAJE_MESA_NO_ENCONTRADA, "comensales");

/** Guard del comando «liberar la mesa sin venta». */
export const guardComandoLiberarMesa = guardDeId<ComandoLiberarMesa>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA);

/** Guard del comando «corregir los comensales»: los `comensales` pasan TAL CUAL (los valida el caso de uso después de encontrar la cuenta abierta). */
export const guardComandoCorregirComensales = guardDeId<ComandoCorregirComensales>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA, "comensales");

/** Guard del comando «asignar o quitar el cliente»: el `clienteId` pasa TAL CUAL (el caso de uso lo busca después de encontrar la cuenta abierta). */
export const guardComandoAsignarClienteACuenta = guardDeId<ComandoAsignarClienteACuenta>("cuentaId", MENSAJE_CUENTA_NO_ENCONTRADA, "clienteId");
