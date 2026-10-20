import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { esImporteAlCentavo } from "@/core/datos/importe";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { CANTIDAD_MAXIMA_DE_OPCION } from "@/core/opciones/public";
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
 *
 * P3 (Paquete 1, I3): la `claveIdempotencia` es OPCIONAL (igual que compras, mermas y ventas: sin ella, el comportamiento de siempre) y, si viene, tiene que ser un UUID
 * (`esClaveIdempotenciaValida`). Se chequea AL FINAL, después de todo lo anterior: así no cambia qué mensaje gana cuando hay dos fallas a la vez.
 *
 * GO-2b (ADR-030): la FORMA de las `opciones` de cada ítem, también AL FINAL (después de la clave): una lista de `{ opcionId, cantidad, versionDeOpcionId }` con
 * textos no vacíos, la cantidad entera de 1 a 10 y la versión OBLIGATORIA (la que vio el mozo), a lo sumo `MAXIMO_OPCIONES_POR_ITEM` por ítem. Una lista vacía se
 * OMITE (el ítem pasa sin la clave `opciones`): así la huella de un pedido sin opciones es la de siempre. Un ítem sin `opciones` pasa TAL CUAL (el mismo objeto).
 * Lo demás de las opciones (que el producto las admita, los topes, los mínimos) lo decide el caso de uso con la base. El tope de líneas contando los adicionales
 * también: recién ahí se sabe cuáles son adicionales.
 *
 * GO-3b (ADR-032): el `precioDeListaEsperado` de cada ítem y el `precioEsperado` de cada promo (opcionales), si vienen, son importes de 0 o más con 2 decimales a lo sumo; si no,
 * se rechaza (no se ignora).
 */
export function guardComandoAgregarItems(entrada: unknown): ResultadoDato<ComandoAgregarItems> {
  const { cuentaId, items, promos, claveIdempotencia } = (entrada ?? {}) as { cuentaId?: unknown; items?: unknown; promos?: unknown; claveIdempotencia?: unknown };
  const items_: ComandoAgregarItems["items"] = Array.isArray(items) ? items : [];
  const promos_: ComandoAgregarItems["promos"] = Array.isArray(promos) ? promos : [];
  if (items_.length === 0 && promos_.length === 0) return rechazar("vacio", "Elegí al menos un producto.");
  const cantidadDeLineas = items_.length + promos_.reduce((suma, p) => suma + componentesDeEleccion(Array.isArray(p?.elecciones) ? p.elecciones : []).length, 0);
  if (cantidadDeLineas > MAXIMO_ITEMS_POR_AGREGADO) return rechazar("rango", `No se pueden agregar más de ${MAXIMO_ITEMS_POR_AGREGADO} ítems de una vez.`);
  if (typeof cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) return rechazar("formato", "Clave de reintento inválida.");
  const conOpciones = itemsConOpcionesValidadas(items_);
  if (!conOpciones.ok) return conOpciones;
  // GO-3b: el precio de la promo que vio el mozo, si viene, es un importe (como el de cada ítem); otra cosa no se ignora en silencio.
  for (const p of promos_) {
    const esperado: unknown = p !== null && typeof p === "object" && "precioEsperado" in p ? (p as { precioEsperado?: unknown }).precioEsperado : undefined;
    if (esperado !== undefined && !esImporteVisto(esperado)) return rechazar("formato", "El precio de la promo que viste no es válido: volvé a elegirla.");
  }
  return aceptar({ cuentaId, items: conOpciones.valor, promos: promos_, ...(claveIdempotencia !== undefined ? { claveIdempotencia } : {}) });
}

/** Tope de opciones elegidas en UN ítem (GO-2b): alcanza de sobra para un producto con varios grupos y corta una lista desmesurada antes de abrir la transacción. */
export const MAXIMO_OPCIONES_POR_ITEM = 20;

const MENSAJE_OPCIONES_INVALIDAS = "Las opciones elegidas no son válidas: volvé a elegirlas.";

/**
 * GO-3b: un precio que vio el mozo: un número de 0 o más, con 2 decimales a lo sumo. El núcleo (finito, 2 decimales) es el de `core/datos/importe.ts`; la regla PROPIA es
 * esta: un `number` (no un texto), no negativo y SIN tope (Fase 2, C3: no se le agrega el de la columna, que cambiaría qué se acepta).
 */
function esImporteVisto(v: unknown): v is number {
  return typeof v === "number" && v >= 0 && esImporteAlCentavo(v);
}

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** La forma de las `opciones` de cada ítem (ver el docstring de `guardComandoAgregarItems`). */
function itemsConOpcionesValidadas(items: ComandoAgregarItems["items"]): ResultadoDato<ComandoAgregarItems["items"]> {
  const salida: ComandoAgregarItems["items"] = [];
  for (const item of items) {
    // GO-3b (ADR-032): el precio de lista que vio el mozo, si viene, es un importe (0 o más, con 2 decimales a lo sumo); otra cosa no se ignora en silencio.
    const esperado: unknown = item !== null && typeof item === "object" && "precioDeListaEsperado" in item ? (item as { precioDeListaEsperado?: unknown }).precioDeListaEsperado : undefined;
    if (esperado !== undefined && !esImporteVisto(esperado)) {
      return rechazar("formato", "El precio que viste no es válido: volvé a elegir el producto.");
    }
    const opciones: unknown = item !== null && typeof item === "object" && "opciones" in item ? (item as { opciones?: unknown }).opciones : undefined;
    if (opciones === undefined) {
      salida.push(item);
      continue;
    }
    if (!Array.isArray(opciones)) return rechazar("formato", MENSAJE_OPCIONES_INVALIDAS);
    if (opciones.length > MAXIMO_OPCIONES_POR_ITEM) return rechazar("rango", `Un ítem admite como máximo ${MAXIMO_OPCIONES_POR_ITEM} opciones.`);
    for (const o of opciones as unknown[]) {
      const { opcionId, cantidad, versionDeOpcionId } = (o ?? {}) as { opcionId?: unknown; cantidad?: unknown; versionDeOpcionId?: unknown };
      if (!esTextoNoVacio(opcionId) || !esTextoNoVacio(versionDeOpcionId)) return rechazar("formato", MENSAJE_OPCIONES_INVALIDAS);
      if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA_DE_OPCION) {
        return rechazar("rango", `La cantidad de una opción tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`);
      }
    }
    if (opciones.length === 0) {
      salida.push(Object.fromEntries(Object.entries(item).filter(([clave]) => clave !== "opciones")) as (typeof items)[number]);
      continue;
    }
    salida.push({ ...item, opciones: (opciones as { opcionId: string; cantidad: number; versionDeOpcionId: string }[]).map((o) => ({ opcionId: o.opcionId, cantidad: o.cantidad, versionDeOpcionId: o.versionDeOpcionId })) });
  }
  return aceptar(salida);
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
