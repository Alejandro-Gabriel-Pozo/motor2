import type { Prisma } from "@prisma/client";

/**
 * Qué filas de `SeccionHabitualProducto` valen en una sucursal, en UN solo lugar (lo usan `cargarHabituales` de la venta y
 * `obtenerSeccionHabitualEnSucursal` del catálogo): la fila es de ESA sucursal y su sección sigue activa. Una sección dada de baja deja la fila
 * en la base pero deja de valer: "sin fila vigente" = el producto no tiene sección habitual (ajuste opcional, no un error).
 */
export function whereSeccionHabitualVigente(sucursalId: string): Prisma.SeccionHabitualProductoWhereInput {
  return { sucursalId, seccion: { sucursalId, activa: true } };
}
