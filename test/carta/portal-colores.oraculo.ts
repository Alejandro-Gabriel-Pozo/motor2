/**
 * ORÁCULO de «Colores del portal» (escrito APARTE del código, legible): la tabla de reglas esperadas que recorre `portal-colores-combinaciones.test.ts`. No importa nada de `src/`: lo que dice cada fila es lo que el DUEÑO pidió (decisión 2026-11-17: «Sí, los tres fondos elegibles.»;
 * instrucción: «2.- si como pedernal»: lo que no se lee se AJUSTA, no se rechaza), y la regla de Pedernal (`color-de-la-carta.ts:14,102-119`): texto blanco o negro, fondo a 7:1 AL MOSTRAR.
 *
 * DIMENSIONES cuyas combinaciones cambian lo que se ve: (1) el fondo elegido (`null` = el de siempre), (2) el color de texto que la empresa ya tenía cargado sobre ese fondo (el cargado manda solo si se lee). Una dimensión nueva (un cuarto fondo, otra clave) hace fallar el guardián del test.
 */

/** Lo que cada fondo elegido tiene que dar, con valores simples a mano (blanco, negro y gris claro no se ajustan; el gris medio sí). */
export const FONDOS_ELEGIDOS = [
  { nombre: "sin fondo", elegido: null, esperado: { mostrado: null, texto: null, aviso: false } },
  { nombre: "blanco", elegido: "#ffffff", esperado: { mostrado: "#ffffff", texto: "#000000", aviso: false } },
  { nombre: "negro", elegido: "#000000", esperado: { mostrado: "#000000", texto: "#ffffff", aviso: false } },
  { nombre: "amarillo", elegido: "#ffff00", esperado: { mostrado: "#ffff00", texto: "#000000", aviso: false } },
  { nombre: "azul oscuro", elegido: "#1f4e79", esperado: { mostrado: "#1f4e79", texto: "#ffffff", aviso: false } },
  { nombre: "mayúsculas", elegido: "#1B1F24", esperado: { mostrado: "#1b1f24", texto: "#ffffff", aviso: false } },
  // El gris medio de la maqueta (`portal-de-la-empresa.html:799`, #777777): ni el blanco ni el negro llegan a 7 a 1; se oscurece conservando el tono (sigue siendo gris) hasta 7 a 1 con texto BLANCO, se AVISA y se guarda el elegido.
  { nombre: "gris medio #777777 (se ajusta y avisa)", elegido: "#777777", esperado: { mostrado: "ajustado-oscuro", texto: "#ffffff", aviso: true } },
  { nombre: "mal escrito", elegido: "azul", esperado: { mostrado: null, texto: null, aviso: false } },
] as const;

/** El texto que la empresa ya tenía cargado sobre el fondo: sin cargar, legible sobre cualquier fondo oscuro/claro según el caso, o ilegible. */
export const TEXTOS_CARGADOS = [
  { nombre: "sin cargar", cargado: "" },
  { nombre: "blanco cargado", cargado: "#ffffff" },
  { nombre: "negro cargado", cargado: "#000000" },
  { nombre: "gris medio cargado", cargado: "#808080" },
  { nombre: "nombre CSS (no se lee)", cargado: "red" },
] as const;

/** Las claves del portal que dependen de cada fondo (los textos que van encima). Es la declaración de qué dimensiones tocan qué. */
export const DEPENDEN_DE = {
  encabezado: { fondo: "portal_header_bg", textos: ["portal_header_color", "portal_etiqueta_color", "portal_titulo_color"] },
  pagina: { fondo: "portal_fondo_color", textos: [] as string[] },
  detras: { fondo: "portal_card_bg", textos: ["portal_card_color", "portal_card_color_hover", "portal_card_notas_color", "portal_card_flecha_color"] },
} as const;

/** Todas las claves de color del portal y si el cambio de un fondo las toca. Una clave nueva que no esté acá hace fallar el guardián: hay que decidir (la decide el dueño) si la afecta un fondo. */
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
  // Las que ningún fondo toca (se quedan como están cargadas):
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
