import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoDarDeAltaProductoRapido, ComandoSincronizarPrecioGrupoCarta } from "./productos.schema";

/**
 * Guard de la feature «productos del catálogo» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-12). Formato del comando, ANTES de tocar
 * la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin
 * Prisma ni permisos.
 *
 * Tienen guard el alta rápida y la sincronización del precio de un ítem agrupado (H4C-13): sus validaciones iban TODAS antes de la primera lectura. El alta
 * completa y la edición validan con `validarDatosDeProducto`, que lee la unidad de stock a mitad de camino (sus decimales validan el factor y el paso de venta):
 * esas no tienen guard.
 */

/**
 * Guard del comando «alta rápida de una MP» (el wizard de compra): EXACTAMENTE lo que antes era lo primero de `darDeAltaProductoRapido`
 * (src/server/actions/catalogo/productos.ts), con los MISMOS textos y en el MISMO orden: el nombre (recortado, no vacío, charset y largo de catálogo) y que venga
 * la unidad de stock. Que el nombre esté libre lo resuelve el caso de uso.
 */
export function guardComandoDarDeAltaProductoRapido(entrada: { nombre: unknown; unidadStockId: string }): ResultadoDato<ComandoDarDeAltaProductoRapido> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre no puede estar vacío.", "El nombre");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  if (!entrada.unidadStockId) return rechazar("vacio", "La unidad de stock es obligatoria.");
  return aceptar({ nombre: nombre.valor, unidadStockId: entrada.unidadStockId });
}

/**
 * Guard del comando «aplicar el mismo precio de venta global a los productos de un ítem agrupado» (H4C-13): EXACTAMENTE lo que antes era lo primero de
 * `sincronizarPrecioGrupoCarta`, antes de leer el ítem agrupado, con los MISMOS textos y en el MISMO orden: el precio (un número estricto, no negativo) y la lista
 * sin repetidos y no vacía. Que sean todos del mismo ítem agrupado lo resuelve el caso de uso.
 */
export function guardComandoSincronizarPrecioGrupoCarta(entrada: { productoIds: string[]; precio: number }): ResultadoDato<ComandoSincronizarPrecioGrupoCarta> {
  const { precio } = entrada;
  if (!esNumeroEstricto(precio)) return rechazar("formato", "El precio de venta no es un número válido.");
  if (!(precio >= 0)) return rechazar("negativo", "El precio de venta no puede ser negativo.");
  const ids = [...new Set(entrada.productoIds)];
  if (!ids.length) return rechazar("vacio", "No hay productos para actualizar.");
  return aceptar({ productoIds: ids, precio });
}
