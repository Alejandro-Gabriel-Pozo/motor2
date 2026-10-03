/**
 * Descripciones puras de auditoría de `guardarReceta` (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 2,
 * D6(b)) — sin Prisma, para poder testearlas sin base y para no repetir el armado del texto en el server action.
 */

/** Cada guardado de la receta central (`guardarReceta`) deja UN registro de auditoría por versión nueva, siempre manual (guardarReceta no recibe `origen`). */
export function describirCambioVersionReceta(productoNombre: string, sucursalNombre: string): string {
  return `Receta de "${productoNombre}" guardada desde "${sucursalNombre}".`;
}

/** Cada guardado de la receta PROPIA de una sucursal deja UN registro por versión nueva (con la sucursal: es un dato de ella, no de la empresa). */
export function describirRecetaPropiaGuardada(productoNombre: string, sucursalNombre: string, version: number): string {
  return `Receta propia de "${productoNombre}" en "${sucursalNombre}" guardada como versión ${version}.`;
}

/** Copiar la receta propia de otra sucursal: queda como una versión nueva de la propia de esta (la de origen no se toca). */
export function describirCopiaDeRecetaPropia(productoNombre: string, sucursalNombre: string, sucursalOrigenNombre: string, version: number): string {
  return `Receta de "${productoNombre}" en "${sucursalNombre}" copiada de la receta propia de "${sucursalOrigenNombre}" (versión ${version}).`;
}

/** «Volver a la central»: la sucursal deja de usar su receta propia (las versiones quedan como historial) y rige la central. */
export function describirVueltaALaRecetaCentral(productoNombre: string, sucursalNombre: string): string {
  return `Receta de "${productoNombre}" en "${sucursalNombre}": vuelve a usar la receta central.`;
}
