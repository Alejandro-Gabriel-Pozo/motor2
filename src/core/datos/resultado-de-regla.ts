/**
 * Resultado de una REGLA PURA de un dato (texto de catálogo, CUIT): `{ ok: true, valor }` o `{ ok: false, error }`, con el motivo de rechazo de un
 * conjunto CERRADO de códigos (un tipo de unión por regla). Es la misma forma que `Resultado<T, E>` de Pedernal (`src/primitivas/resultado`), que
 * Motor2 no tenía; no reemplaza a `ResultadoDato` (el de los validadores que arman un mensaje para la pantalla): quien conecta una regla a una
 * pantalla traduce el código a su mensaje. Puro: sin reloj ni azar.
 */
export type ResultadoDeRegla<T, E extends string> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: E };

export function valido<T>(valor: T): ResultadoDeRegla<T, never> {
  return { ok: true, valor };
}

export function invalido<E extends string>(error: E): ResultadoDeRegla<never, E> {
  return { ok: false, error };
}
