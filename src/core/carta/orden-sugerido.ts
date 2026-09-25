/**
 * Orden SUGERIDO al ubicar algo en la carta (docs/plan-carta-seccion-directa-2026-09-25.md, DA5/DA6). Lógica PURA, sin Prisma: la
 * usa un componente "use client" (src/components/carta/seccion-y-orden.tsx), así que no puede arrastrar `@/lib/db` al bundle.
 *
 * La sugerencia es "al final": la cantidad de lo que ya está ahí (secciones entre sí, o ítems dentro de una sección). Sigue siendo
 * solo el valor inicial del campo: se puede cambiar a mano.
 */

/**
 * DA6: qué orden mostrar en el campo cuando se elige `seccionElegida` en el select de sección de un producto o ítem agrupado.
 *  - Sin sección elegida: no se toca (`null`).
 *  - Volver a la sección que ya tenía guardada: su orden guardado (editar sin cambiar de sección nunca pisa el valor real).
 *  - Una sección distinta (o algo nuevo, sin sección guardada): la cantidad de ítems que ya hay en esa sección.
 */
export function ordenSugeridoAlElegirSeccion(
  seccionElegida: string,
  guardado: { seccionCartaId: string | null; orden: number } | null,
  cantidadPorSeccion: Readonly<Record<string, number>>
): number | null {
  if (!seccionElegida) return null;
  if (guardado?.seccionCartaId && guardado.seccionCartaId === seccionElegida) return guardado.orden;
  return cantidadPorSeccion[seccionElegida] ?? 0;
}
