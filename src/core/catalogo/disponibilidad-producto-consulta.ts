/**
 * El criterio de «disponible en esta sucursal» como `where` de Prisma (Pureza Fase 4, tramo A): PURO (objetos planos, sin base). Los lectores que consultan la tabla
 * (`productoDisponibleEn`, `disponibilidadDeProductos`, `disponibilidadEnAlgunaSucursal`, `disponibilidadPorSucursalDeProducto`) viven en `server/lecturas/catalogo/disponibilidad.ts`.
 * Se devuelven `as const` (sin tipos de Prisma) para que este archivo no arrastre el cliente de base.
 */

/**
 * Capa de consulta de `disponibilidad-producto.ts` (pura) — separada a propósito en su PROPIO archivo, aunque el plan
 * (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §3) las diseñó juntas: `disponibilidad-producto.ts` importa `@/lib/db`
 * acá, y eso arrastra Prisma/`pg` al bundle del cliente en cuanto un componente "use client" importe un VALOR (no un tipo) del
 * mismo archivo — el bug real que ya reventó el build una vez esta sesión (rendimiento-recetas-vistas.ts, ver su docstring).
 * Nunca reunir Prisma con las funciones puras de disponibilidad en el mismo archivo.
 *
 * Ninguna pantalla escribe `{ disponibilidades: { some: ... } }` a mano — todas pasan por acá. Fijado por el guardián de
 * arquitectura `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts` (P12).
 */

/** El ÚNICO lugar donde se escribe el criterio como `where` de Prisma para "disponible en ESTA sucursal". */
export function whereDisponibleEn(sucursalId: string) {
  return { disponibilidades: { some: { sucursalId, disponible: true } } } as const;
}

/** El equivalente del `activo: true` global de antes — para las validaciones del catálogo central (nombre único, unidad de un Insumo, etc.), que no son decisiones de una sucursal puntual. */
export function whereDisponibleEnAlguna() {
  return { disponibilidades: { some: { disponible: true } } } as const;
}
