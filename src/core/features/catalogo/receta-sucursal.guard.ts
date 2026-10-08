import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoVolverALaRecetaCentral } from "./receta-sucursal.schema";

/**
 * Guard de la feature «receta PROPIA de la sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-6). Formato del comando, ANTES de
 * tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma
 * ni permisos.
 *
 * Guard del comando «volver a la receta central»: es EXACTAMENTE lo primero que hacía `volverALaRecetaCentral`, antes de abrir la transacción: sin la
 * confirmación explícita (cualquier valor falso), «Confirmá que querés volver a la receta central.». El `productoId` pasa tal cual (lo resuelve el caso de uso).
 */
export function guardComandoVolverALaRecetaCentral(entrada: { productoId: string; confirmado: boolean }): ResultadoDato<ComandoVolverALaRecetaCentral> {
  if (!entrada.confirmado) return rechazar("vacio", "Confirmá que querés volver a la receta central.");
  return aceptar({ productoId: entrada.productoId });
}
