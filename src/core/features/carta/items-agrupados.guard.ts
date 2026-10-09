import { LARGO_MAXIMO_DESCRIPCION_CARTA, normalizarTagsCarta, validarNombreItemAgrupadoCarta, validarOrdenCarta, validarTextoLibreCarta } from "@/core/carta/public";
import { MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO, validarTopeDeLista } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoActualizarOrdenOpcionItemAgrupadoCarta, ComandoGuardarItemAgrupadoCarta } from "./items-agrupados.schema";

/**
 * Guard de la feature «ítems agrupados de la carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del
 * comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("carta_items_agrupados",…)`, así que el rechazo por permiso sigue
 * llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Solo las acciones cuyas validaciones iban TODAS antes de la primera lectura tienen guard: `guardarItemAgrupadoCarta` (el nombre, la descripción, los tags, el orden, el
 * tope de productos y que haya sección elegida) y `actualizarOrdenOpcionItemAgrupadoCarta` (el orden va antes de buscar la opción, así que un orden roto gana sobre
 * «no se encontró»). Apagar o prender, agregar una opción (lee el ítem antes de mirar el producto) y quitar una opción quedan sin guard (`SIN_GUARD` con motivo).
 */

/** Los datos de un ítem agrupado tal como llegan del formulario del admin (los mismos campos que `DatosItemAgrupadoCarta` de la Server Action). */
interface EntradaItemAgrupadoCarta {
  id?: string;
  nombre: unknown;
  seccionCartaId: string;
  descripcion?: unknown;
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: unknown;
  generoCartaId?: string | null;
  productoIds?: readonly string[] | null;
}

/**
 * Guard del comando «guardar un ítem agrupado»: EXACTAMENTE la validación que antes era lo primero de `guardarItemAgrupadoCarta`, antes de leer nada, con los MISMOS
 * textos y en el MISMO orden: el nombre, la descripción, los tags, el orden, el tope de productos y que se haya elegido sección. El `id`, el género y los productos
 * pasan tal cual (los resuelve el caso de uso); `especial` solo vale con `true` exacto.
 */
export function guardComandoGuardarItemAgrupadoCarta(datos: EntradaItemAgrupadoCarta): ResultadoDato<ComandoGuardarItemAgrupadoCarta> {
  const nombre = validarNombreItemAgrupadoCarta(datos.nombre);
  if (!nombre.ok) return rechazar("formato", nombre.mensaje);
  const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return rechazar("largo", descripcion.mensaje);
  const tags = normalizarTagsCarta(datos.tags);
  if (!tags.ok) return rechazar("formato", tags.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  const excedeProductos = validarTopeDeLista(datos.productoIds ?? [], "Los productos", MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO);
  if (excedeProductos) return rechazar("rango", excedeProductos);
  if (!datos.seccionCartaId) return rechazar("vacio", "Elegí la sección de carta del ítem agrupado.");
  return aceptar({
    ...(datos.id ? { id: datos.id } : {}),
    nombre: nombre.valor,
    seccionCartaId: datos.seccionCartaId,
    descripcion: descripcion.valor,
    tags: tags.valor,
    especial: datos.especial === true,
    orden: orden.valor,
    generoCartaId: datos.generoCartaId,
    productoIds: datos.productoIds ?? [],
  });
}

/**
 * Guard del comando «agregar un producto como opción de un ítem agrupado» (S-52): el orden, EXACTAMENTE `validarOrdenCarta` con su mismo texto (entero, |orden| ≤ 100.000: rechaza NaN,
 * ±Infinity, 1e308, un objeto, «12,5»; vacío vale 0). `null` o ausente = al final (la cantidad de opciones del ítem, que sabe el caso de uso: `orden: null`). Lo calcula la acción; su
 * rechazo lo aplica el caso de uso DESPUÉS de leer el ítem, el producto y sus conflictos (el ítem inexistente, «elegí el producto» y «ya está en un ítem» ganan sobre un orden roto).
 */
export function guardComandoAgregarOpcionItemAgrupadoCarta(entrada: { orden: unknown }): ResultadoDato<{ orden: number | null }> {
  if (entrada.orden === null || entrada.orden === undefined) return aceptar({ orden: null });
  // Un orden es un número o un texto con un número (o vacío): un objeto o un arreglo no lo es (`String([])` es vacío y valía 0).
  const orden = validarOrdenCarta(typeof entrada.orden === "object" ? Number.NaN : entrada.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({ orden: orden.valor });
}

/** Guard del comando «cambiar el orden de una opción»: EXACTAMENTE `validarOrdenCarta`, con su mismo texto (vacío o null valen 0). El `opcionId` pasa tal cual (lo resuelve el caso de uso). */
export function guardComandoActualizarOrdenOpcionItemAgrupadoCarta(entrada: { opcionId: string; orden: unknown }): ResultadoDato<ComandoActualizarOrdenOpcionItemAgrupadoCarta> {
  const orden = validarOrdenCarta(entrada.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({ opcionId: entrada.opcionId, orden: orden.valor });
}
