import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { componentesDeEleccion, MAXIMO_ITEMS_POR_AGREGADO } from "@/core/pos/public";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "./cuenta.guard";
import { MENSAJE_ITEM_NO_ENCONTRADO, MENSAJE_PROMO_NO_ENCONTRADA } from "./cuenta-anulacion.guard";
import type { ComandoAgregarItems, ComandoEnviarACocina, ComandoQuitarItemSinEnviar, ComandoQuitarPromoSinEnviar } from "./cuenta-pedido.schema";

/**
 * Guard del PEDIDO de la cuenta de una mesa (feature Cuenta del salón; convención «guard por feature»; Hito 4, bloque 4.1). Formato del comando, ANTES de abrir
 * la transacción, llamado por la Server Action DENTRO de su `conPermiso(…)`. Puro: sin Prisma ni permisos.
 *
 * Replican SOLO los chequeos que la acción ya hacía antes de la transacción, en el mismo orden y con los mismos textos: un guard que adelantara otro chequeo
 * cambiaría qué mensaje gana cuando hay dos fallas a la vez (lo fija `huella-del-pos`).
 */

/**
 * Guard del comando «agregar ítems y promos sin enviar». Los chequeos que `agregarItems` hacía ANTES de abrir la transacción, en el mismo orden y con los mismos
 * textos: lo que no es una lista cuenta como lista vacía; al menos un ítem o una promo («Elegí al menos un producto.»); y el tope de líneas
 * (`MAXIMO_ITEMS_POR_AGREGADO`), que cuenta también los componentes de cada promo (`componentesDeEleccion`, con `elecciones` que no son lista como vacías).
 * Recién DESPUÉS, que el `cuentaId` sea un texto, con el mismo «no encontrada» que respondía `cuentaAbiertaDeSucursal` adentro de la transacción (que salteaba
 * la lectura): una lista vacía sigue ganando sobre una cuenta inválida (lo fija `huella-del-pos`, «ids no texto + lista vacía»). Cada ítem y cada promo pasan
 * TAL CUAL: los valida el caso de uso, uno por uno, como antes.
 */
export function guardComandoAgregarItems(entrada: unknown): ResultadoDato<ComandoAgregarItems> {
  const { cuentaId, items, promos } = (entrada ?? {}) as { cuentaId?: unknown; items?: unknown; promos?: unknown };
  const items_: ComandoAgregarItems["items"] = Array.isArray(items) ? items : [];
  const promos_: ComandoAgregarItems["promos"] = Array.isArray(promos) ? promos : [];
  if (items_.length === 0 && promos_.length === 0) return rechazar("vacio", "Elegí al menos un producto.");
  const cantidadDeLineas = items_.length + promos_.reduce((suma, p) => suma + componentesDeEleccion(Array.isArray(p?.elecciones) ? p.elecciones : []).length, 0);
  if (cantidadDeLineas > MAXIMO_ITEMS_POR_AGREGADO) return rechazar("rango", `No se pueden agregar más de ${MAXIMO_ITEMS_POR_AGREGADO} ítems de una vez.`);
  if (typeof cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  return aceptar({ cuentaId, items: items_, promos: promos_ });
}

/**
 * Guard del comando «quitar un ítem sin enviar». Solo el `cuentaItemId`: si no es un texto, el MISMO mensaje que «no encontrado» (`MENSAJE_ITEM_NO_ENCONTRADO`,
 * el mismo texto que usa la anulación) — exactamente lo que ya respondía `quitarItemSinEnviar`, que con un id que no es texto salteaba la lectura.
 */
export function guardComandoQuitarItemSinEnviar(entrada: unknown): ResultadoDato<ComandoQuitarItemSinEnviar> {
  const { cuentaItemId } = (entrada ?? {}) as { cuentaItemId?: unknown };
  if (typeof cuentaItemId !== "string") return rechazar("formato", MENSAJE_ITEM_NO_ENCONTRADO);
  return aceptar({ cuentaItemId });
}

/**
 * Guard del comando «quitar una promo sin enviar». Solo el `promoCuentaId`: si no es un texto, el MISMO mensaje que «no encontrada»
 * (`MENSAJE_PROMO_NO_ENCONTRADA`, el mismo texto que usa la anulación) — lo que ya respondía `quitarPromoSinEnviar`, que con un id que no es texto salteaba la
 * lectura.
 */
export function guardComandoQuitarPromoSinEnviar(entrada: unknown): ResultadoDato<ComandoQuitarPromoSinEnviar> {
  const { promoCuentaId } = (entrada ?? {}) as { promoCuentaId?: unknown };
  if (typeof promoCuentaId !== "string") return rechazar("formato", MENSAJE_PROMO_NO_ENCONTRADA);
  return aceptar({ promoCuentaId });
}

/** Tope de ítems de un solo «Enviar a cocina» (vivía como constante privada de `src/server/actions/pos/cuenta-pedido.ts`; mismo número). */
const MAXIMO_ITEMS_POR_ENVIO = 200;

/**
 * Guard del comando «enviar a cocina». Los dos chequeos que `enviarACocina` hacía ANTES de abrir la transacción, en el mismo orden y con los mismos textos: una
 * lista no vacía de textos («No hay ítems para enviar.») y el tope (`MAXIMO_ITEMS_POR_ENVIO`). Recién DESPUÉS, que el `cuentaId` sea un texto, con el mismo
 * «no encontrada» que respondía `cuentaAbiertaDeSucursal` adentro de la transacción (que salteaba la lectura): así una lista inválida sigue ganando sobre una
 * cuenta inválida, como antes.
 */
export function guardComandoEnviarACocina(entrada: unknown): ResultadoDato<ComandoEnviarACocina> {
  const { cuentaId, itemIds } = (entrada ?? {}) as { cuentaId?: unknown; itemIds?: unknown };
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((id) => typeof id !== "string")) return rechazar("formato", "No hay ítems para enviar.");
  if (itemIds.length > MAXIMO_ITEMS_POR_ENVIO) return rechazar("rango", `No se pueden enviar más de ${MAXIMO_ITEMS_POR_ENVIO} ítems de una vez.`);
  if (typeof cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  return aceptar({ cuentaId, itemIds: itemIds as string[] });
}
