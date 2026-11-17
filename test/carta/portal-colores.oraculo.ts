/**
 * ORÁCULO de «Colores del portal» (escrito APARTE del código, legible). Decisiones del dueño, 2026-11-17: «Sí, los tres fondos elegibles.» y «Ve como un pedernal.»: el texto y los íconos del portal NO dependen del color elegido (colores fijos del sistema a 7:1 o más sobre los fondos del sistema); el color
 * solo pinta ACENTOS y bordes; se guarda tal cual (sin ajuste ni aviso). Referencia de Pedernal: `apps/web/ui/tokens.css:43-49` («lo único que sale de la marca») y `apps/web/ui/plantillas/vidriera/contraste.test.ts` («una marca no puede bajar la legibilidad»).
 *
 * DIMENSIONES cuyas combinaciones cambian lo que se ve: (1) cuál de los tres colores se elige, (2) la marca elegida (incluidos los PEORES CASOS), (3) lo que la empresa ya tenía cargado en el Json. Una clave de color nueva del catálogo del portal sin declarar hace fallar el guardián.
 */

/** Las marcas de peor caso para un texto (la que da menos contraste con cualquier texto es el gris medio; el blanco, el negro y el amarillo son los extremos). `null` = no se eligió color. */
export const MARCAS = [
  { nombre: "sin color", elegida: null, guardada: null },
  { nombre: "blanco", elegida: "#ffffff", guardada: "#ffffff" },
  { nombre: "negro", elegida: "#000000", guardada: "#000000" },
  { nombre: "amarillo", elegida: "#ffff00", guardada: "#ffff00" },
  { nombre: "gris medio", elegida: "#808080", guardada: "#808080" },
  { nombre: "mayúsculas (se guarda en minúsculas)", elegida: "#FFFF00", guardada: "#ffff00" },
  { nombre: "mal escrito (no se pinta)", elegida: "amarillo", guardada: null },
] as const;

/** A qué variable CSS de acento llega cada color elegido (y SOLO a esa). */
export const ACENTO_DE = {
  encabezado: ["--portal-acento-encabezado"],
  pagina: ["--portal-acento-pagina"],
  detras: ["--portal-card-border", "--portal-card-border-hover"],
} as const;

/** Los tokens FIJOS del sistema (`.carta-shell` en `src/app/globals.css`) y los pares texto/fondo del portal que se miden. Un guardián compara estos valores con el CSS. */
export const TOKENS_DEL_SISTEMA = { "--carta-bg": "#ffffff", "--carta-ink": "#1c1b19", "--carta-ink-soft": "#57534e" } as const;
export const PARES_DE_TEXTO = [
  ["--carta-ink", "--carta-bg"],
  ["--carta-ink-soft", "--carta-bg"],
] as const;

/** Todas las claves de color del catálogo del portal y si un color elegido las toca. Ninguna es de texto o ícono y la toque un color elegido. */
export const CLAVES_DE_COLOR_DEL_PORTAL_DECLARADAS = [
  "portal_header_bg",
  "portal_header_color",
  "portal_etiqueta_color",
  "portal_titulo_color",
  "portal_fondo_color",
  "portal_card_bg",
  "portal_card_color",
  "portal_card_color_hover",
  "portal_card_notas_color",
  "portal_card_flecha_color",
  "portal_card_border",
  "portal_card_border_hover",
  "portal_marca_derivada",
  "portal_color_marca",
] as const;

/** Contraste WCAG 2.1 entre dos `#rrggbb` (fórmula del estándar, escrita acá sin usar la del producto). */
export function contrasteWcag(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
