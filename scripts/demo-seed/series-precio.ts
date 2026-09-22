import { conProbabilidad, gaussiana, real, type GeneradorAleatorio } from "./prng";

/**
 * Serie de precios de compra por semana — resuelve el hallazgo de §5 ("Precios de compra con una serie temporal real —
 * necesario para Período/IPC/dólar y para que el historial de precios diga algo") frente al seed actual, donde
 * `PRECIOS_REFERENCIA` es un valor único y constante por (producto, proveedor) durante toda la ventana.
 *
 * Tres componentes, cada uno con su propio sentido de negocio:
 * - **Tendencia**: inflación mensual esperada, compuesta semana a semana (no lineal: un precio que sube 4%/mes sube más en
 *   plata en el mes 6 que en el mes 1, como la inflación real).
 * - **Dispersión**: ruido gaussiano semana a semana (sube y baja, no un escalón monótono) — un precio negociado real no es
 *   una recta.
 * - **Saltos puntuales**: con una probabilidad chica por semana, un salto ADICIONAL y siempre hacia arriba (§0, regla 4: "las
 *   variaciones creíbles... precios de compra que suben" es la que se pidió; una baja brusca de golpe leería como error de
 *   carga, no como variación real — ver UMBRAL_VARIACION_SOSPECHOSA_PCT en periodo.ts, que marca subas MUY grandes como
 *   sospechosas: los saltos de acá se mantienen bien por debajo de ese umbral).
 */
export interface ConfigSerieDePrecio {
  precioInicial: number;
  /** Cantidad de semanas a generar — la semana 0 es siempre `precioInicial`, sin ruido. */
  semanas: number;
  /** Ej. 0.04 = 4 % mensual, como tendencia central de la deriva (compuesta, no lineal). */
  inflacionMensualEsperada: number;
  /** Desvío estándar RELATIVO del ruido semana a semana (ej. 0.015 = 1,5 %). */
  dispersionSemanal: number;
  /** Probabilidad de que una semana dada tenga, además del ruido normal, un salto puntual (ej. 0.03 = 3 % de las semanas). */
  probabilidadSaltoSemanal: number;
  /** Rango del salto puntual, como fracción (ej. 0.08 a 0.20 = entre 8 % y 20 %) — siempre hacia arriba. */
  saltoMinPct: number;
  saltoMaxPct: number;
}

export interface PuntoDeSerie {
  semana: number;
  precio: number;
  /** Esta semana tuvo un salto puntual (además del ruido normal) — para poder resaltarlo en el guion o en los datos de referencia del seed. */
  esSalto: boolean;
}

/** Semanas por mes calendario en promedio (52 / 12) — para componer una tasa mensual en una tasa semanal equivalente. */
const SEMANAS_POR_MES = 52 / 12;

/** Piso de seguridad: el ruido nunca hace caer el precio por debajo del 30 % del inicial — una demo no necesita un precio que se desploma, y eso sería un dato inverosímil, no una variación creíble. */
const PISO_RELATIVO = 0.3;

function redondearPrecio(precio: number): number {
  return Math.round(precio * 100) / 100;
}

export function generarSerieDePrecio(config: ConfigSerieDePrecio, rand: GeneradorAleatorio): PuntoDeSerie[] {
  if (!(config.precioInicial > 0)) throw new Error(`generarSerieDePrecio: precioInicial tiene que ser > 0 (recibido ${config.precioInicial})`);
  if (!(config.semanas >= 1) || !Number.isInteger(config.semanas)) throw new Error(`generarSerieDePrecio: semanas tiene que ser un entero >= 1 (recibido ${config.semanas})`);
  if (config.saltoMaxPct < config.saltoMinPct) throw new Error("generarSerieDePrecio: saltoMaxPct no puede ser menor que saltoMinPct");

  const factorSemanal = Math.pow(1 + config.inflacionMensualEsperada, 1 / SEMANAS_POR_MES);
  const piso = config.precioInicial * PISO_RELATIVO;

  const serie: PuntoDeSerie[] = [{ semana: 0, precio: redondearPrecio(config.precioInicial), esSalto: false }];
  let precio = config.precioInicial;

  for (let semana = 1; semana < config.semanas; semana++) {
    precio *= factorSemanal;
    precio *= 1 + gaussiana(rand) * config.dispersionSemanal;

    let esSalto = false;
    if (conProbabilidad(rand, config.probabilidadSaltoSemanal)) {
      precio *= 1 + real(rand, config.saltoMinPct, config.saltoMaxPct);
      esSalto = true;
    }

    precio = Math.max(precio, piso);
    serie.push({ semana, precio: redondearPrecio(precio), esSalto });
  }

  return serie;
}

/** El precio vigente en una semana dada de la serie — la última semana generada si `semana` se pasa del final (la serie no se extrapola sola). */
export function precioEnSemana(serie: readonly PuntoDeSerie[], semana: number): number {
  if (!serie.length) throw new Error("precioEnSemana: serie vacía");
  const punto = serie[Math.min(Math.max(semana, 0), serie.length - 1)]!;
  return punto.precio;
}
