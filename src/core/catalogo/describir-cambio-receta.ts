/**
 * Descripciones puras de auditoría de `guardarReceta` (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 2,
 * D6(b)) — sin Prisma, para poder testearlas sin base y para no repetir el armado del texto en el server action.
 */

/** Cada guardado de la receta central (`guardarReceta`) deja UN registro de auditoría por versión nueva, siempre manual (guardarReceta no recibe `origen`). */
export function describirCambioVersionReceta(productoNombre: string, sucursalNombre: string): string {
  return `Receta de "${productoNombre}" guardada desde "${sucursalNombre}".`;
}
