/**
 * Cuánto cambia un precio al editarlo (decisión del dueño, «Registro de decisiones» de la emulación, 2026-10-20: «antes → después» SIEMPRE y confirmación extra si el precio cambia
 * MÁS de 30 %). Es solo la comparación que decide cuándo la pantalla pide confirmar: no calcula ningún precio que se cobre ni toca el comando que lo guarda.
 *
 * Se compara en centavos enteros (un importe tiene a lo sumo 2 decimales): 30 % exacto NO pide confirmación («más de 30 %»), y 0,1 + 0,2 no se desvía por el punto flotante. Sin precio de partida
 * (cero) no hay contra qué comparar: no hay porcentaje y no pide confirmación.
 */
export const UMBRAL_DE_CAMBIO_DE_PRECIO = 0.3;

export interface CambioDePrecio {
  antes: number;
  despues: number;
  /** `despues - antes` en pesos (puede ser negativo). */
  diferencia: number;
  /** El cambio en por ciento sobre `antes` (con signo); `null` si `antes` es cero o menor. */
  porcentaje: number | null;
  /** `true` si cambia más de 30 %: la pantalla pide una confirmación aparte antes de guardar. */
  pideConfirmar: boolean;
}

export function cambioDePrecio(antes: number, despues: number): CambioDePrecio {
  const centavosAntes = Math.round(antes * 100);
  const centavosDespues = Math.round(despues * 100);
  const delta = centavosDespues - centavosAntes;
  const hayReferencia = centavosAntes > 0;
  return {
    antes,
    despues,
    diferencia: delta / 100,
    porcentaje: hayReferencia ? (delta / centavosAntes) * 100 : null,
    // |delta| / antes > 0,3  <=>  |delta| * 10 > antes * 3 (enteros: sin redondeo de punto flotante).
    pideConfirmar: hayReferencia && Math.abs(delta) * 10 > centavosAntes * 3,
  };
}
