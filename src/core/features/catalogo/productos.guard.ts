import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoDarDeAltaProductoRapido } from "./productos.schema";

/**
 * Guard de la feature «productos del catálogo» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-12). Formato del comando, ANTES de tocar
 * la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin
 * Prisma ni permisos.
 *
 * Solo el alta rápida tiene guard: sus validaciones iban TODAS antes de la primera lectura. El alta completa y la edición validan con
 * `validarDatosDeProducto`, que lee la unidad de stock a mitad de camino (sus decimales validan el factor y el paso de venta): esas no tienen guard.
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
