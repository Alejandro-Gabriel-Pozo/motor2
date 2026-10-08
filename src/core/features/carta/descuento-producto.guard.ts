import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarDescuentoProducto } from "./descuento-producto.schema";

/**
 * Guard de la feature «descuento de un producto en la sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-1). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro:
 * sin Prisma ni permisos.
 *
 * Es EXACTAMENTE la validación que antes era lo primero de `guardarDescuentoProducto`, antes de leer el producto: `validarPorcentajeDescuento` con
 * `obligatorio: false` (vacío es válido: saca el descuento), con su mismo texto; y la misma normalización: vacío o 0 → `null`. El `productoId` pasa tal cual,
 * sin chequear (antes tampoco se chequeaba: lo resuelve el caso de uso, «No se encontró el producto.»).
 */
export function guardComandoGuardarDescuentoProducto(entrada: { productoId: string; porcentaje: unknown }): ResultadoDato<ComandoGuardarDescuentoProducto> {
  const validado = validarPorcentajeDescuento(entrada.porcentaje, { obligatorio: false });
  if (!validado.ok) return rechazar(validado.codigo, validado.mensaje);
  const porcentaje = validado.valor && validado.valor > 0 ? validado.valor : null;
  return aceptar({ productoId: entrada.productoId, porcentaje });
}
