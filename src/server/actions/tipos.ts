import type { SincronizablePrecioGrupo } from "@/core/carta/grupo-producto-consulta";

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; mensaje: string };

/** Como ResultadoAccion, pero además devuelve el id de lo creado — para los quick-create inline (ver src/components/catalogo). */
export type ResultadoConId = { ok: true; mensaje: string; id: string; nombre: string } | { ok: false; mensaje: string };

export type { SincronizablePrecioGrupo };

/**
 * Como ResultadoAccion, más `sincronizable` (aditivo, opcional) cuando se cambió el precio de un producto que está en un ítem agrupado
 * de la carta y sus hermanos quedaron a otro precio (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8).
 */
export type ResultadoConSincronizable = { ok: true; mensaje: string; sincronizable?: SincronizablePrecioGrupo } | { ok: false; mensaje: string };

export function ok(mensaje: string): ResultadoAccion {
  return { ok: true, mensaje };
}

export function okConId(mensaje: string, id: string, nombre: string): ResultadoConId {
  return { ok: true, mensaje, id, nombre };
}

// Tipado como solo la rama `false` (no la unión completa) a propósito: así
// `error(...)` es asignable tanto a ResultadoAccion como a ResultadoConId
// (y a cualquier otro resultado con la misma rama de error) sin necesidad
// de un cast en cada callback de conPermiso<T>.
export function error(mensaje: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje };
}
