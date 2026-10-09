import { ENTERO_MAXIMO_RAZONABLE, validarNumeroHasta } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import type { ComandoSetFrecuenciaConteo } from "./frecuencia-conteo.schema";

/**
 * Guard del comando «fijar cada cuántos días se cuenta un producto en esta sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-19).
 * EXACTAMENTE lo que antes era lo primero de `setFrecuenciaConteo` (src/server/actions/stock/frecuencia-conteo.ts), antes de leer el producto, con los MISMOS
 * textos y en el MISMO orden: un entero de 0 o más, un número estricto y no más que `ENTERO_MAXIMO_RAZONABLE`. El 0 es un valor real (desactiva la agenda de ese
 * producto sin borrar la fila). El producto no se valida acá (lo resuelve el caso de uso). Lo llama la Server Action DENTRO de su `conPermiso(…)`. Puro: sin
 * Prisma ni permisos. `eliminarFrecuenciaConteo` no tiene guard (solo recibe un id).
 */
export function guardComandoSetFrecuenciaConteo(entrada: { productoId: string; frecuenciaDias: number }): ResultadoDato<ComandoSetFrecuenciaConteo> {
  const { frecuenciaDias } = entrada;
  if (!Number.isInteger(frecuenciaDias) || frecuenciaDias < 0) return rechazar("formato", "La frecuencia tiene que ser un número entero de días, 0 o más.");
  if (!esNumeroEstricto(frecuenciaDias)) return rechazar("formato", "La frecuencia no es un número válido.");
  const alta = validarNumeroHasta(frecuenciaDias, "La frecuencia", ENTERO_MAXIMO_RAZONABLE);
  if (alta) return rechazar("rango", alta);
  return aceptar({ productoId: entrada.productoId, frecuenciaDias });
}
