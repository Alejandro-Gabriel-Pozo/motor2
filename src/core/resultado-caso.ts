/**
 * Resultado de un CASO DE USO de mutación (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md). Módulo PURO: sin
 * Prisma, React ni `server-only`.
 *
 * Un caso de uso (`src/server/actions/<dominio>/casos-de-uso/<verbo>.ts`) devuelve MÁS que lo que ve la pantalla: un `codigo` estable
 * para distinguir el motivo de un fracaso sin comparar textos (tests, futuros llamadores) y los `datos` de lo que hizo (ids creados,
 * cantidades). La Server Action que lo envuelve lo traduce con `aResultadoAccion` al formato que la UI ya lee (`ResultadoAccion`,
 * src/server/actions/tipos.ts): `{ ok, mensaje }` y NADA más — `datos`, `codigo` y `erroresPorCampo` se descartan a propósito, para no
 * serializarle al navegador ids internos ni cambiar la forma que ya consumen ~110 pantallas y ~89 tests.
 *
 * No se importa `ResultadoAccion` acá: `core/` no conoce a `server/` (regla `core-sin-capas-superiores` de dependency-cruiser, ni
 * siquiera con `import type`). La forma de `ResultadoMensaje` es la misma, y `test/core/resultado-caso.test.ts` lo compara con
 * `expectTypeOf` (lo chequea `tsc --noEmit`, que incluye los tests).
 */
export type ResultadoCaso<T, C extends string> =
  | { ok: true; mensaje: string; datos: T }
  | { ok: false; codigo: C; mensaje: string; erroresPorCampo?: Record<string, string> };

/** La rama de éxito sola (mismo criterio que `error()` de tipos.ts): asignable a cualquier `ResultadoCaso<T, C>` sin cast. */
export type Exito<T> = Extract<ResultadoCaso<T, string>, { ok: true }>;

/** La rama de fracaso sola: asignable a cualquier `ResultadoCaso<T, C>` cuyo `C` incluya este código. */
export type Fracaso<C extends string> = Extract<ResultadoCaso<unknown, C>, { ok: false }>;

/** `{ ok, mensaje }`: la misma forma que `ResultadoAccion` de src/server/actions/tipos.ts. */
export type ResultadoMensaje = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export function exito<T>(mensaje: string, datos: T): Exito<T> {
  return { ok: true, mensaje, datos };
}

export function fracaso<C extends string>(codigo: C, mensaje: string, erroresPorCampo?: Record<string, string>): Fracaso<C> {
  return erroresPorCampo ? { ok: false, codigo, mensaje, erroresPorCampo } : { ok: false, codigo, mensaje };
}

/** Lo que la Server Action le devuelve a la pantalla: solo `ok` y `mensaje`. `datos`, `codigo` y `erroresPorCampo` NO pasan. */
export function aResultadoAccion(resultado: ResultadoCaso<unknown, string>): ResultadoMensaje {
  return resultado.ok ? { ok: true, mensaje: resultado.mensaje } : { ok: false, mensaje: resultado.mensaje };
}
