/**
 * Formato de la clave de idempotencia (I3, docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §11.1). Módulo PURO, como todo
 * `src/core/datos/`: sin `node:crypto`, Prisma ni `server-only`, así lo pueden usar los guards de `core/features/` (Task #41, Fase M).
 *
 * Vivía en `src/core/movimientos/idempotencia.ts`, que sigue reexportándola: ese archivo usa `node:crypto` (el hash del payload) y
 * recibe el `tx` de Prisma, así que no puede ser el hogar de una validación pura.
 */

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** §11.1: formato validado en la capa de aplicación antes de tocar la DB — nunca se guarda un string que no sea un UUID. */
export function esClaveIdempotenciaValida(clave: unknown): clave is string {
  return typeof clave === "string" && REGEX_UUID.test(clave);
}
