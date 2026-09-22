/**
 * Generador pseudoaleatorio con semilla fija — pieza pura del seed de la demo (docs/planes-demo-y-claridad-reportes-2026-09-21.md
 * §5, "Diseño recomendado": "un generador pseudoaleatorio con semilla fija... para poder generar el guion de forma reproducible
 * en el desarrollo del seed"). Nada de esto corre en producción ni en la aplicación: es una herramienta de testing del propio
 * seed, para que la MISMA semilla produzca SIEMPRE el mismo guion de 6 meses (reproducible en CI, en un review, o al reintentar
 * después de un fallo a mitad de corrida).
 *
 * `Math.random()` no sirve para esto por diseño: no acepta semilla, así que dos corridas del seed generarían guiones distintos
 * y un test que comparara "el guion de hoy" contra "el guion de ayer" no podría confiar en nada.
 */

/** Una función que, llamada repetidamente, da la siguiente secuencia determinística de [0, 1) para la semilla con la que se creó. */
export type GeneradorAleatorio = () => number;

/**
 * mulberry32 — PRNG de 32 bits, rápido y con buena distribución para esto (no es criptográfico, no hace falta que lo sea: es
 * para generar datos de demostración, no claves). La semilla se normaliza con `>>> 0` para aceptar cualquier entero, incluido
 * uno negativo o fuera de rango de 32 bits.
 */
export function crearGeneradorAleatorio(semilla: number): GeneradorAleatorio {
  let estado = semilla >>> 0;
  return function siguiente(): number {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entero uniforme en [min, max], ambos extremos inclusive. */
export function entero(rand: GeneradorAleatorio, min: number, max: number): number {
  if (max < min) throw new Error(`entero: max (${max}) < min (${min})`);
  return min + Math.floor(rand() * (max - min + 1));
}

/** Número real uniforme en [min, max). */
export function real(rand: GeneradorAleatorio, min: number, max: number): number {
  return min + rand() * (max - min);
}

/** `true` con probabilidad `p` (0 a 1). */
export function conProbabilidad(rand: GeneradorAleatorio, p: number): boolean {
  return rand() < p;
}

/** Un elemento al azar, con probabilidad uniforme. El array no puede estar vacío. */
export function elegir<T>(rand: GeneradorAleatorio, opciones: readonly T[]): T {
  if (!opciones.length) throw new Error("elegir: no hay opciones");
  return opciones[entero(rand, 0, opciones.length - 1)]!;
}

/**
 * Ruido gaussiano (media 0, desvío estándar 1) vía Box-Muller — hace falta para la dispersión semana a semana de la serie de
 * precios (series-precio.ts): un ruido uniforme (`real`) sube y baja con la misma probabilidad en cualquier punto, mientras que
 * el gaussiano concentra la mayoría de las semanas cerca del promedio y deja los saltos grandes para la cola, que es como se
 * mueve un precio real semana a semana.
 */
export function gaussiana(rand: GeneradorAleatorio): number {
  // Evita log(0): rand() da [0, 1), 1 - rand() da (0, 1].
  const u1 = 1 - rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
