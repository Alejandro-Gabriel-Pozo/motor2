/**
 * Puesto de venta del salón (ADR-039: «el mostrador es un puesto del salón»). Un puesto es una `Mesa`: de tipo `SALON` (las mesas numeradas de siempre) o
 * `MOSTRADOR` (uno por sucursal, sin número visible). Puro, sin base: lo leen las pantallas, los casos de uso del POS y los reportes.
 *
 * El mostrador ocupa el número 0 de `Mesa.numero` (el alta de mesas da de 1 a 9999: `Mesa_numero_segun_tipo_chk` de la base impone `(tipo = 'MOSTRADOR') = (numero = 0)`),
 * así que el código que solo tiene el número —las lecturas congeladas cargan `mesa.numero`, no el tipo— lo reconoce con {@link esMostrador} sin cambiar su forma.
 *
 * REGLA DE TEXTOS (guardián de arquitectura `test/arquitectura/puesto-sin-texto-de-mesa-a-mano.test.ts`): ningún texto «Mesa N» / «mesa N» se arma a mano en los
 * casos de uso del POS, la persistencia del POS ni las pantallas del POS; todos salen de acá. Para una mesa de salón cada frase es BYTE A BYTE la de siempre.
 */

/**
 * Los tipos de puesto que acepta la base (`Mesa.tipo`, CHECK `Mesa_tipo_chk`; la cuenta lleva el de su puesto en `Cuenta.tipoMesa`, CHECK `Cuenta_tipoMesa_chk`). Ampliar la lista (por
 * ejemplo «para llevar») es ampliar los dos CHECK con otra migración: lo vigila `test/persistencia/migracion-puesto-mostrador.test.ts`.
 */
export const TIPOS_DE_PUESTO = ["SALON", "MOSTRADOR"] as const;

/** El número que ocupa el puesto mostrador en `Mesa.numero`. */
const NUMERO_DEL_MOSTRADOR = 0;

/** ¿Es el puesto mostrador? (por su número; el CHECK de la base garantiza que solo él lleva el 0). */
export function esMostrador(numero: number): boolean {
  return numero === NUMERO_DEL_MOSTRADOR;
}

/** Cómo se rotula el puesto en pantalla: «Mesa 07» (mismo formato de número que la tarjeta del mapa) o «Mostrador». */
export function rotuloDePuesto(numero: number): string {
  return esMostrador(numero) ? "Mostrador" : `Mesa ${String(numero).padStart(2, "0")}`;
}

/** Las frases con las que los mensajes, la auditoría y el `detalle` de la venta nombran al puesto. */
export interface FrasesDePuesto {
  /** «Mesa 7» | «Mostrador»: el `detalle` de la `Operacion` y el comienzo de una descripción de auditoría («Mesa 7: cliente de la cuenta»). */
  detalle: string;
  /** «la mesa 7» | «el mostrador» (a mitad de frase). */
  el: string;
  /** «La mesa 7» | «El mostrador» (al comienzo de una frase). */
  El: string;
  /** «de la mesa 7» | «del mostrador». */
  del: string;
  /** «a la mesa 7» | «al mostrador». */
  al: string;
}

export function frasesDePuesto(numero: number): FrasesDePuesto {
  if (esMostrador(numero)) return { detalle: "Mostrador", el: "el mostrador", El: "El mostrador", del: "del mostrador", al: "al mostrador" };
  return { detalle: `Mesa ${numero}`, el: `la mesa ${numero}`, El: `La mesa ${numero}`, del: `de la mesa ${numero}`, al: `a la mesa ${numero}` };
}
