import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_SUCURSAL_CAMBIADA } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import { aCentavos, deCentavos, validarAjusteDePrecio } from "@/core/carta/public";
import {
  MAXIMO_DE_CAMBIOS_DE_HOY,
  MAXIMO_DE_PRECIOS_POR_AJUSTE,
  type ComandoAgregarProductoALaCarta,
  type ComandoAjustarPreciosDeLaCarta,
  type ComandoAjustarPreciosDeLaEmpresa,
  type ComandoFijarDisponibilidadDeHoy,
  type ComandoQuitarProductoDeLaCarta,
} from "./mantenimiento.schema";

/**
 * Guard de la feature «mantenimiento de la carta» (CARTA-MANT). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`. Puro.
 *
 * Lo PRIMERO es el eco de la sucursal (como el de las opciones por sucursal y el menú del día): la pantalla manda la sucursal que tenía cargada y, si ya no es la activa (cambió de sucursal en
 * otra pestaña), no se escribe nada. El caso de uso escribe SOLO en la sucursal activa del contexto; las políticas por sucursal de la base son la segunda barrera (42501).
 */

const LARGO_MAXIMO_DE_ID = 64;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function eco(sucursalId: unknown, sucursalActivaId: string): ResultadoDato<null> {
  return sucursalId === sucursalActivaId ? aceptar(null) : rechazar("formato", MENSAJE_SUCURSAL_CAMBIADA);
}

export function guardComandoAgregarProductoALaCarta(entrada: { sucursalId: unknown; sucursalActivaId: string; productoId: unknown; seccionCartaId: unknown }): ResultadoDato<ComandoAgregarProductoALaCarta> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const seccionCartaId = id(entrada.seccionCartaId, "Elegí la sección de la carta donde va.");
  if (!seccionCartaId.ok) return seccionCartaId;
  return aceptar({ productoId: productoId.valor, seccionCartaId: seccionCartaId.valor });
}

/** «Hoy» (varios productos, todo o nada): el eco, después la lista (de 1 al tope, sin repetidos) y cada cambio (un id y un booleano). */
export function guardComandoFijarDisponibilidadDeHoy(entrada: { sucursalId: unknown; sucursalActivaId: string; cambios: unknown }): ResultadoDato<Omit<ComandoFijarDisponibilidadDeHoy, "puedeEditarCamposSensibles">> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  if (!Array.isArray(entrada.cambios) || entrada.cambios.length === 0) return rechazar("formato", "No hay ningún producto para cambiar.");
  if (entrada.cambios.length > MAXIMO_DE_CAMBIOS_DE_HOY) return rechazar("formato", `Son demasiados productos de una vez (el máximo es ${MAXIMO_DE_CAMBIOS_DE_HOY}).`);
  const cambios: ComandoFijarDisponibilidadDeHoy["cambios"] = [];
  const vistos = new Set<string>();
  for (const c of entrada.cambios as unknown[]) {
    const fila = typeof c === "object" && c !== null ? (c as { productoId?: unknown; disponible?: unknown }) : {};
    const productoId = id(fila.productoId, "No se encontró el producto.");
    if (!productoId.ok) return productoId;
    if (typeof fila.disponible !== "boolean") return rechazar("formato", "Falta decir si el producto queda disponible o sin stock.");
    if (vistos.has(productoId.valor)) return rechazar("formato", "Un producto figura dos veces en el mismo cambio.");
    vistos.add(productoId.valor);
    cambios.push({ productoId: productoId.valor, disponible: fila.disponible });
  }
  return aceptar({ cambios });
}

/** «Quitar de la carta»: el eco, el producto y si se confirmó perder lo cargado (un booleano; si no llega, `false`). */
export function guardComandoQuitarProductoDeLaCarta(entrada: { sucursalId: unknown; sucursalActivaId: string; productoId: unknown; confirmado?: unknown }): ResultadoDato<ComandoQuitarProductoDeLaCarta> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  return aceptar({ productoId: productoId.valor, confirmado: entrada.confirmado === true });
}

/** El ajuste (`validarAjusteDePrecio`, la misma regla que la vista previa) y la lista (de 1 al tope, sin repetidos, cada precio visto con hasta dos decimales). */
function ajusteYProductos(entrada: { ajuste: unknown; items: unknown }): ResultadoDato<ComandoAjustarPreciosDeLaCarta> {
  const a = typeof entrada.ajuste === "object" && entrada.ajuste !== null ? (entrada.ajuste as Record<string, unknown>) : {};
  const ajuste = validarAjusteDePrecio({ direccion: a.direccion, modo: a.modo, valor: a.valor, redondeo: a.redondeo });
  if (!ajuste.ok) return rechazar("formato", ajuste.mensaje);
  if (!Array.isArray(entrada.items) || entrada.items.length === 0) return rechazar("formato", "No hay ningún producto para cambiar de precio.");
  if (entrada.items.length > MAXIMO_DE_PRECIOS_POR_AJUSTE) return rechazar("formato", `Son demasiados productos de una vez (el máximo es ${MAXIMO_DE_PRECIOS_POR_AJUSTE}).`);
  const items: ComandoAjustarPreciosDeLaCarta["items"] = [];
  const vistos = new Set<string>();
  for (const x of entrada.items as unknown[]) {
    const fila = typeof x === "object" && x !== null ? (x as { productoId?: unknown; precioVisto?: unknown }) : {};
    const productoId = id(fila.productoId, "No se encontró el producto.");
    if (!productoId.ok) return productoId;
    const precio = typeof fila.precioVisto === "string" ? aCentavos(fila.precioVisto) : null;
    if (precio === null) return rechazar("formato", "El precio que se vio no es válido: recargá la pantalla.");
    if (vistos.has(productoId.valor)) return rechazar("formato", "Un producto figura dos veces en el mismo ajuste.");
    vistos.add(productoId.valor);
    items.push({ productoId: productoId.valor, precioVisto: deCentavos(precio) });
  }
  return aceptar({ ajuste: ajuste.valor, items });
}

/** F4 «Precios», en esta sucursal: el eco, después el ajuste y la lista. */
export function guardComandoAjustarPreciosDeLaCarta(entrada: { sucursalId: unknown; sucursalActivaId: string; ajuste: unknown; items: unknown }): ResultadoDato<ComandoAjustarPreciosDeLaCarta> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  return ajusteYProductos(entrada);
}

/** F4 «Precios», en toda la empresa: el ajuste, la lista y la confirmación (solo `true` confirma). */
export function guardComandoAjustarPreciosDeLaEmpresa(entrada: { ajuste: unknown; items: unknown; confirmado: unknown }): ResultadoDato<Omit<ComandoAjustarPreciosDeLaEmpresa, "puedeEditarCamposSensibles">> {
  const base = ajusteYProductos(entrada);
  if (!base.ok) return base;
  return aceptar({ ...base.valor, confirmado: entrada.confirmado === true });
}

/** F4 «Precios», el aviso de «En toda la empresa» (solo lectura): de 1 al tope de productos de un ajuste, sin repetidos. */
export function guardComandoAvisoDePrecioDeEmpresa(entrada: { productoIds: unknown }): ResultadoDato<{ productoIds: string[] }> {
  if (!Array.isArray(entrada.productoIds) || entrada.productoIds.length === 0) return rechazar("formato", "No hay ningún producto para cambiar de precio.");
  if (entrada.productoIds.length > MAXIMO_DE_PRECIOS_POR_AJUSTE) return rechazar("formato", `Son demasiados productos de una vez (el máximo es ${MAXIMO_DE_PRECIOS_POR_AJUSTE}).`);
  const productoIds: string[] = [];
  for (const x of entrada.productoIds as unknown[]) {
    const productoId = id(x, "No se encontró el producto.");
    if (!productoId.ok) return productoId;
    if (productoIds.includes(productoId.valor)) return rechazar("formato", "Un producto figura dos veces en el mismo ajuste.");
    productoIds.push(productoId.valor);
  }
  return aceptar({ productoIds });
}
