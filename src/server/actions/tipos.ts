import type { SincronizablePrecioGrupo } from "@/core/carta/public-servidor";

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; mensaje: string };

/** Como ResultadoAccion, pero además devuelve el id de lo creado — para los quick-create inline (ver src/components/catalogo). */
export type ResultadoConId = { ok: true; mensaje: string; id: string; nombre: string } | { ok: false; mensaje: string };

export type { SincronizablePrecioGrupo };

/**
 * Como ResultadoAccion, más `sincronizable` (aditivo, opcional) cuando se cambió el precio de un producto que está en un ítem agrupado
 * de la carta y sus hermanos quedaron a otro precio (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8).
 */
export type ResultadoConSincronizable = { ok: true; mensaje: string; sincronizable?: SincronizablePrecioGrupo } | { ok: false; mensaje: string };

/**
 * Resultado de `enviarACocina` (src/server/actions/pos/cuenta-pedido.ts): como ResultadoAccion y, al salir bien, además el envío que le tocó
 * a ESTA llamada — así la pantalla de la mesa imprime la comanda que el servidor confirmó y no la que infiere de lo que ve
 * (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B2):
 * - `numeroEnvio`: el envío nuevo que creó o, si esos ítems ya estaban enviados, el envío en el que salieron (null si ninguno de los
 *   ids está enviado en esta cuenta: otra cuenta, o se quitaron);
 * - `envioNuevo`: true solo si esta llamada creó el envío. Una pestaña vieja recibe el envío de otro con `envioNuevo: false`.
 */
export type ResultadoEnvioACocina = { ok: true; mensaje: string; numeroEnvio: number | null; envioNuevo: boolean } | { ok: false; mensaje: string };

/**
 * Resultado de `emitirBoletaCorregida` (src/server/actions/pos/cuenta-cierre.ts): como ResultadoAccion y, al salir bien, el ejemplar que emitió
 * ESTA llamada (mismo número, ejemplar siguiente) — así la pantalla de la mesa imprime ese ejemplar y no el que infiere de lo que ve
 * (mismo criterio que `ResultadoEnvioACocina`; docs/plan-numeracion-boleta-2026-09-25.md, paso 7).
 */
export type ResultadoBoletaCorregida = { ok: true; mensaje: string; numero: number; ejemplar: number } | { ok: false; mensaje: string };

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
