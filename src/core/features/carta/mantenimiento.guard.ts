import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_SUCURSAL_CAMBIADA } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import {
  MAXIMO_DE_CAMBIOS_DE_HOY,
  type ComandoAgregarProductoALaCarta,
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
