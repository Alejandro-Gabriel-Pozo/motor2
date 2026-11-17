/**
 * VELO y TEXTO de la portada CON foto (Frente 7, paso «rubro, lugar y foto de portada»; dueño, 2026-11-17: «Si suma foto de portada» y, sobre el velo, «Opcion 2 pero la forma del velo espero no sea esa y se note como se nota ahi»).
 * Regla de Pedernal (`carta-libro-especificacion.md` §14.1): contraste de 7:1 medido sobre el PEOR píxel de la caja de cada texto, y el texto NO depende del color de marca. Una foto puede ser cualquiera, así que el peor caso es una
 * foto BLANCA: el velo negro tiene que dejarla lo bastante oscura detrás de cada texto.
 *
 * Valores FIJOS (sin opción ni velo configurable). Con foto, los textos de la portada van BLANCOS y SIN atenuar (opacidad 1; la atenuación de rubro, lugar y descripción es solo de la portada sin foto). Foto blanca bajo un velo negro de alfa A,
 * mezclada en sRGB como lo hace el navegador: con A = 0,67 la foto blanca queda en 84/255 y el texto blanco llega a 7,57:1 (con 0,65 sería 7,0, sin margen). Cálculo y barrido en `test/carta/portada-velo.test.ts`.
 *
 * FORMA: no es una caja (se notaba como un rectángulo oscuro) sino una elipse: parejo a 0,67 en el centro y fundido con una curva suave hasta 0 en el borde de un elemento MÁS GRANDE que el bloque de textos (el doble de ancho y el triple de alto,
 * `VELO_INSET_X_PCT` y `VELO_INSET_Y_PCT`, en % del bloque, así vale para cualquier tamaño de bloque). La meseta pareja (`VELO_MESETA`) llega más allá de las esquinas del bloque: las esquinas de cualquier bloque caen a 0,6 del radio
 * como máximo (`fraccionDeLaEsquinaDelBloque`) y la meseta llega a 0,65.
 */
export const VELO_ALFA_SOBRE_FOTO = 0.67;

/** Color del texto de la portada con foto cuando la empresa no cargó uno propio (`color_portada_textos` o `hero_ink`): blanco, sobre el velo negro. No toma el color de marca. */
export const TEXTO_SOBRE_FOTO = "#ffffff";

/** El elemento del velo sobresale del bloque de textos en % de su ancho y de su alto (a cada lado): ancho total = 2 × el del bloque, alto total = 3 × el del bloque. */
export const VELO_INSET_X_PCT = 50;
export const VELO_INSET_Y_PCT = 100;

/** Hasta qué fracción del radio de la elipse (0 = centro, 1 = borde del elemento) el velo es PAREJO. Más allá se desvanece con una curva suave (smoothstep) hasta 0. */
export const VELO_MESETA = 0.65;

/** Alfa del velo a una fracción `r` del radio (la misma curva que el CSS de abajo). */
export function alfaDelVeloEnFraccion(r: number): number {
  if (r <= VELO_MESETA) return VELO_ALFA_SOBRE_FOTO;
  if (r >= 1) return 0;
  const t = (r - VELO_MESETA) / (1 - VELO_MESETA);
  return VELO_ALFA_SOBRE_FOTO * (1 - t * t * (3 - 2 * t));
}

/** Fracción del radio donde cae la esquina de un bloque de `ancho` × `alto` (px) dentro del elemento del velo, con `holgura` px de margen alrededor de la caja del texto. */
export function fraccionDeLaEsquinaDelBloque(ancho: number, alto: number, holgura = 0): number {
  const w = ancho + 2 * holgura;
  const h = alto + 2 * holgura;
  const W = ancho * (1 + (2 * VELO_INSET_X_PCT) / 100);
  const H = alto * (1 + (2 * VELO_INSET_Y_PCT) / 100);
  return Math.hypot(w / W, h / H);
}

const PASOS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
const parada = (r: number): string => `oklch(0 0 0 / ${Math.round(alfaDelVeloEnFraccion(r) * 10000) / 10000}) ${Math.round(r * 10000) / 100}%`;
/** Degradé elíptico (`closest-side`: la elipse toca los lados del elemento, así llega a 0 antes del borde y no queda ningún corte visible): meseta pareja y borde suave. */
export const VELO_DEGRADE_SOBRE_FOTO = `radial-gradient(ellipse closest-side, ${parada(0)}, ${[...PASOS].map((t) => parada(VELO_MESETA + t * (1 - VELO_MESETA))).join(", ")})`;
