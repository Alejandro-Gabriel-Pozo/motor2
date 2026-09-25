/**
 * Módulo central de validación de datos (docs/plan-validacion-de-datos-2026-09-25.md). Todo lo de `src/core/datos/` es PURO: sin
 * React, Prisma ni `server-only`, así la MISMA función valida en la pantalla (CampoNumero) y en la Server Action.
 *
 * `ResultadoDato<T>` sigue la convención `{ ok: true, valor } | { ok: false, mensaje }` de `Resultado<T>` (src/core/carta/validaciones.ts)
 * y es asignable a ella; suma un `codigo` estable para que el que llama pueda distinguir el motivo sin comparar textos.
 */
export type CodigoDato = "vacio" | "formato" | "negativo" | "cero" | "decimales" | "rango" | "largo" | "sin_alfanumerico" | "caracteres";

export type ResultadoDato<T> = { ok: true; valor: T } | { ok: false; codigo: CodigoDato; mensaje: string };

export function aceptar<T>(valor: T): ResultadoDato<T> {
  return { ok: true, valor };
}

export function rechazar<T = never>(codigo: CodigoDato, mensaje: string): ResultadoDato<T> {
  return { ok: false, codigo, mensaje };
}

/** "El precio" → "el precio": para armar "Falta el precio." con la misma etiqueta que el resto de los mensajes. */
export function enMinuscula(etiqueta: string): string {
  return etiqueta.charAt(0).toLowerCase() + etiqueta.slice(1);
}
