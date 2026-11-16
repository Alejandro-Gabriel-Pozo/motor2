/**
 * Conversión de los pasos libres ya cargados a fracciones (E1b, docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md §8 y Q1): el
 * NÚCLEO PURO del mapa. Pedido del dueño (2026-11-15): «Convertirlos a la fracción más cercana». Reescribir un dato existente NO está en
 * la autorización permanente: este archivo solo CALCULA qué haría el mapa (no escribe nada, no toca ninguna base); aplicarlo exige
 * autorización expresa por base, con ensayo (otra etapa).
 *
 * Aritmética sobre enteros de 4 decimales (diezmilésimos), sin coma flotante. Distancia absoluta a ½ = 5.000, ¼ = 2.500, ⅛ = 1.250;
 * empate → la más fina. Lo que no cae exacto NO se redondea en silencio: queda «pendiente de completar» con su propuesta a la vista,
 * y un valor que la regla vigente no admite queda pendiente SIN propuesta. Nada se inventa (I16).
 *
 * Idempotencia: convertir lo ya convertido no cambia nada (O26). Reversa: devuelve el paso original (O27).
 */
import { ESCALA, esPasoValido, PORCIONES_PERMITIDAS, type Diezmilesimos, type Magnitud, type Porcion } from "./fracciones-y-peso";

export interface EntradaDeConversion {
  /** `Producto.pasoVenta` en diezmilésimos; `null` = sin paso (una unidad entera). */
  readonly pasoVenta: Diezmilesimos | null;
  /** Las fracciones ya cargadas (vacío = ninguna). Si hay, el producto ya está convertido. */
  readonly porcionesActuales: readonly Porcion[];
  /** `Unidad.magnitud` de la unidad de stock. Las fracciones son solo de una unidad de conteo (I3). */
  readonly magnitud: Magnitud;
}

export const RESULTADOS_DE_CONVERSION = ["NADA", "AUTOMATICA", "PENDIENTE_CON_PROPUESTA", "PENDIENTE_SIN_PROPUESTA"] as const;

export type Conversion =
  /** Nada que hacer: ya es «Unidad» (paso nulo o 1) o ya tiene fracciones. */
  | { readonly resultado: "NADA" }
  /** El paso es EXACTAMENTE ½, ¼ o ⅛: se completa solo la fracción; el paso no cambia. */
  | { readonly resultado: "AUTOMATICA"; readonly porciones: readonly [Porcion]; readonly pasoResultante: Diezmilesimos }
  /** Una persona con permiso la confirma, un producto por vez; se avisa antes («hoy se vende de a 0,2; pasaría a ¼»). */
  | { readonly resultado: "PENDIENTE_CON_PROPUESTA"; readonly porciones: readonly [Porcion]; readonly pasoResultante: Diezmilesimos }
  /** La persona elige Unidad, Fracciones o Peso; no hay propuesta. */
  | { readonly resultado: "PENDIENTE_SIN_PROPUESTA" };

const SIN_CAMBIO: Conversion = { resultado: "NADA" };

/** La fracción más cercana a un paso por distancia absoluta; con empate, la más fina (la de mayor porción). */
export function fraccionMasCercana(paso: Diezmilesimos): Porcion {
  let mejor: Porcion = PORCIONES_PERMITIDAS[0];
  for (const porcion of PORCIONES_PERMITIDAS) {
    const distancia = Math.abs(paso - ESCALA / porcion);
    const distanciaDelMejor = Math.abs(paso - ESCALA / mejor);
    if (distancia < distanciaDelMejor || distancia === distanciaDelMejor) mejor = porcion; // el recorrido va de la más gruesa a la más fina: el empate gana la fina
  }
  return mejor;
}

/** Qué haría el mapa con un producto. Pura y total. */
export function convertirPasoLibre(entrada: EntradaDeConversion): Conversion {
  const { pasoVenta, porcionesActuales, magnitud } = entrada;
  if (porcionesActuales.length > 0) return SIN_CAMBIO; // ya convertido: idempotente (O26)
  if (pasoVenta === null) return magnitud === "CANTIDAD" ? SIN_CAMBIO : { resultado: "PENDIENTE_SIN_PROPUESTA" }; // masa sin paso: elige la persona
  if (pasoVenta === ESCALA) return SIN_CAMBIO; // paso 1: ya es «Unidad»
  if (magnitud !== "CANTIDAD") return { resultado: "PENDIENTE_SIN_PROPUESTA" }; // las fracciones son de conteo (I3): no se propone nada
  if (!esPasoValido(pasoVenta)) return { resultado: "PENDIENTE_SIN_PROPUESTA" }; // no admitido por la regla vigente (por ejemplo 0,3)
  const porcion = fraccionMasCercana(pasoVenta);
  const pasoResultante = ESCALA / porcion;
  return { resultado: pasoVenta === pasoResultante ? "AUTOMATICA" : "PENDIENTE_CON_PROPUESTA", porciones: [porcion], pasoResultante };
}

/** Lo que queda en el producto al deshacer una conversión (O27): el paso vuelve al original, las fracciones se vacían y el original se anula. */
export function revertirConversion(pasoLibreOriginal: Diezmilesimos): { readonly pasoVenta: Diezmilesimos; readonly porcionesOfrecidas: readonly []; readonly pasoLibreOriginal: null } {
  return { pasoVenta: pasoLibreOriginal, porcionesOfrecidas: [], pasoLibreOriginal: null };
}
