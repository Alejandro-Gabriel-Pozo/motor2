/**
 * VELO y TEXTO de la portada CON foto (Frente 7, paso «rubro, lugar y foto de portada»; dueño, 2026-11-17: «Si suma foto de portada»). Regla de Pedernal (`carta-libro-especificacion.md` §14.1): contraste de 7:1 medido sobre el PEOR píxel
 * de la caja de cada texto, y el texto NO depende del color de marca. Una foto puede ser cualquiera, así que el peor caso es una foto BLANCA: el velo negro tiene que dejarla lo bastante oscura detrás de cada texto.
 *
 * Valores FIJOS (sin opción ni velo configurable). Cálculo con `razonDeContraste` (`test/carta/portada-velo.test.ts`): texto blanco con la opacidad que ya tiene cada línea de la portada (rubro 0,7, nombre 1, lugar 0,6, descripción 0,75),
 * fondo = foto blanca bajo un velo negro de alfa A, mezclado en sRGB como lo hace el navegador. El alfa mínimo que llega a 7:1 es 0,80 (rubro), 0,65 (nombre), 0,905 (lugar) y 0,765 (descripción): manda el lugar (opacidad 0,6). Se usa 0,92.
 * El velo es una caja pareja que cubre TODO el bloque de textos con un margen, con borde difuminado hacia afuera (no un degradé radial: en el borde de un radial el alfa baja a 0 y no hay garantía para el texto que llega hasta ahí).
 */
export const VELO_ALFA_SOBRE_FOTO = 0.92;

/** Color del texto de la portada con foto cuando la empresa no cargó uno propio (`color_portada_textos` o `hero_ink`): blanco, sobre el velo negro. No toma el color de marca. */
export const TEXTO_SOBRE_FOTO = "#ffffff";

/** Fondo y sombra difuminada del velo sobre la foto (CSS). La sombra repite el alfa y se desvanece hacia afuera de la caja, que es donde ya no hay texto. */
export const VELO_FONDO_SOBRE_FOTO = `oklch(0 0 0 / ${VELO_ALFA_SOBRE_FOTO})`;
export const VELO_SOMBRA_SOBRE_FOTO = `0 0 2.5rem 1.5rem oklch(0 0 0 / ${VELO_ALFA_SOBRE_FOTO})`;
