/**
 * Los datos de las cinco cartas REALES de hoy (copia de producción del 12/11, rama de ensayo, leída el 2026-11-13): el fondo oscuro, los textos blancos y UNA marca por sucursal. Los valores son los reales
 * (de cada clave, el conjunto de valores distintos que hay cargados); lo que NO se verificó es qué valor de `color_banda_etiqueta`, `color_banda_*` y `color_indice_numeros` (hay dos distintos en las cinco) le toca a cada
 * sucursal: las cinco combinaciones de abajo son plausibles, no un volcado. Sirven para la prueba «sin cambio»: una carta SIN el marcador `marca_derivada` se lee igual que antes de la marca derivada.
 */
const COMUN: Readonly<Record<string, string>> = {
  color_fondo_dia: "#181818",
  hero_color_fondo: "#181818",
  hero_ink: "#ffffff",
  color_portada_textos: "#ffffff",
  color_portada_cta: "#ffffff",
  color_indice_titulo: "#ffffff",
  color_indice_titulos: "#ffffff",
  color_item_nombre: "#ffffff",
  color_item_precio: "#ffffff",
  color_item_descripcion: "#ffffff",
  color_item_tags: "#ffffff",
  color_especial_item_descripcion: "#ffffff",
  color_banda_titulo: "#ffffff",
  topbar_back_color: "#ffffff",
};

export const TEMAS_REALES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  violeta: { ...COMUN, color_marca: "#5c57a2", color_indice_numeros: "#ffffff", color_banda_etiqueta: "#e17360", color_banda_descripcion: "#ffffff", color_nav_flechas: "#5c57a2", color_nav_iconos: "#ffffff" },
  oliva: { ...COMUN, color_marca: "#797d62", color_indice_numeros: "#e17360", color_banda_etiqueta: "oklch(0.9176 0.0214 79.06)", color_banda_descripcion: "oklch(0.9176 0.0214 79.06)", color_nav_flechas: "#ffffff" },
  celeste: { ...COMUN, color_marca: "#96bbbb", color_indice_numeros: "#ffffff", color_banda_etiqueta: "#e17360", color_banda_descripcion: "#ffffff", color_nav_flechas: "#96bbbb", color_nav_iconos: "#ffffff" },
  coral: { ...COMUN, color_marca: "#e17360", color_indice_numeros: "#e17360", color_banda_etiqueta: "#e17360", color_banda_descripcion: "#ffffff" },
  amarillo: { ...COMUN, color_marca: "#ffcb69", color_indice_numeros: "#ffffff", color_banda_etiqueta: "oklch(0.9176 0.0214 79.06)", color_banda_descripcion: "oklch(0.9176 0.0214 79.06)" },
};

/** Lo que guarda el portal real de hoy: el encabezado y siete claves en «transparent». */
export const PORTAL_REAL: Readonly<Record<string, string>> = {
  portal_header_bg: "#e5dfdf",
  portal_card_bg: "transparent",
  portal_card_border: "transparent",
  portal_card_border_hover: "transparent",
  portal_card_color: "transparent",
  portal_card_color_hover: "transparent",
  portal_card_flecha_color: "transparent",
  portal_card_notas_color: "transparent",
};
