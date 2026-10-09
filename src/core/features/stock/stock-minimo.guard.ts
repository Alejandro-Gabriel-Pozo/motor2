import { STOCK_MINIMO_MAXIMO, validarNumeroHasta } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import type { ComandoSetStockMinimo } from "./stock-minimo.schema";

/**
 * Guard del comando «fijar el stock mínimo de un producto en esta sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-21).
 * EXACTAMENTE lo que antes era lo primero de `setStockMinimoProducto` (src/server/actions/stock/stock-minimo.ts), antes de leer el producto, con los MISMOS textos y
 * en el MISMO orden: no negativo (un `NaN` también cae acá: `!(NaN >= 0)`), número estricto y no más que `STOCK_MINIMO_MAXIMO` (la columna es `Decimal(14,4)`). El
 * producto y la sección no se validan acá (los resuelve el caso de uso). Lo llama la Server Action DENTRO de su `conPermiso(…)`. Puro: sin Prisma ni permisos.
 * `eliminarStockMinimo` no tiene guard (solo recibe un id).
 */
export function guardComandoSetStockMinimo(entrada: { productoId: string; minimo: number; seccionId?: string | null }): ResultadoDato<ComandoSetStockMinimo> {
  const { minimo } = entrada;
  if (!(minimo >= 0)) return rechazar("negativo", "El mínimo no puede ser negativo.");
  if (!esNumeroEstricto(minimo)) return rechazar("formato", "El mínimo no es un número válido.");
  const alto = validarNumeroHasta(minimo, "El mínimo", STOCK_MINIMO_MAXIMO);
  if (alto) return rechazar("rango", alto);
  return aceptar({ productoId: entrada.productoId, minimo, seccionId: entrada.seccionId });
}
