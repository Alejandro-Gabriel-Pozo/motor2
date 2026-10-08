import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_ITEM_NO_ENCONTRADO } from "./cuenta-anulacion.guard";
import type { ComandoQuitarItemSinEnviar } from "./cuenta-pedido.schema";

/**
 * Guard del PEDIDO de la cuenta de una mesa (feature Cuenta del salón; convención «guard por feature»; Hito 4, bloque 4.1). Formato del comando, ANTES de abrir
 * la transacción, llamado por la Server Action DENTRO de su `conPermiso(…)`. Puro: sin Prisma ni permisos.
 *
 * Replican SOLO los chequeos que la acción ya hacía antes de la transacción, en el mismo orden y con los mismos textos: un guard que adelantara otro chequeo
 * cambiaría qué mensaje gana cuando hay dos fallas a la vez (lo fija `huella-del-pos`).
 */

/**
 * Guard del comando «quitar un ítem sin enviar». Solo el `cuentaItemId`: si no es un texto, el MISMO mensaje que «no encontrado» (`MENSAJE_ITEM_NO_ENCONTRADO`,
 * el mismo texto que usa la anulación) — exactamente lo que ya respondía `quitarItemSinEnviar`, que con un id que no es texto salteaba la lectura.
 */
export function guardComandoQuitarItemSinEnviar(entrada: unknown): ResultadoDato<ComandoQuitarItemSinEnviar> {
  const { cuentaItemId } = (entrada ?? {}) as { cuentaItemId?: unknown };
  if (typeof cuentaItemId !== "string") return rechazar("formato", MENSAJE_ITEM_NO_ENCONTRADO);
  return aceptar({ cuentaItemId });
}
