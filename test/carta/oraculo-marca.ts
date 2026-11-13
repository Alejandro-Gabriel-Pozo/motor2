/**
 * Oráculo de la marca de la carta (regla de combinaciones, 2026-10-28; diseño `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md`, nivel 10): la tabla de lo ESPERADO, escrita aparte del código
 * (`src/core/carta/marca-derivada.ts`) y legible sin leerlo. El test que la recorre es `marca-derivada.test.ts`; el guardián de claves, `marca-claves-de-color.test.ts`.
 *
 * Dimensiones que cambian el resultado: el color de la marca (claro, oscuro, saturado, gris, extremos) y el fondo contra el que se mide. Cada fila dice la tinta que sale sobre la marca y si la marca pasa
 * M2 (texto >= 4,5:1) y M3 (marca contra fondo BLANCO >= 3:1). Las cinco primeras son las marcas REALES de las cinco sucursales de hoy (rama de ensayo del 2026-11-13); sus razones de contraste se
 * calcularon con la fórmula de WCAG 2.1 y las dos tintas fijas del sistema (clara = oklch(0.96 0.005 80) ≈ #f3f1ee, oscura = oklch(0.18 0.02 40) ≈ #190f0b; NO son blanco ni negro puros): por ejemplo #96bbbb contra
 * blanco da 2,07:1 y #ffcb69 da 1,50:1; #5c57a2 con la tinta clara 5,58:1; #e17360 con la oscura 6,12:1; #797d62 con la oscura 4,42:1 (por eso no pasa M2).
 */
export interface FilaDeMarca {
  marca: string;
  nota: string;
  tinta: "clara" | "oscura";
  /** M2: ¿alguna de las dos tintas fijas llega a 4,5:1 sobre la marca? */
  pasaTexto: boolean;
  /** M3 contra el fondo blanco: ¿llega a 3:1? */
  pasaContraBlanco: boolean;
}

export const FILAS_DE_MARCA: readonly FilaDeMarca[] = [
  { marca: "#5c57a2", nota: "sucursal real: violeta oscuro", tinta: "clara", pasaTexto: true, pasaContraBlanco: true },
  { marca: "#797d62", nota: "sucursal real: verde oliva; la mejor tinta (oscura) llega a 4,42:1, no a 4,5", tinta: "oscura", pasaTexto: false, pasaContraBlanco: true },
  { marca: "#96bbbb", nota: "sucursal real: celeste grisáceo; contra blanco 2,07:1", tinta: "oscura", pasaTexto: true, pasaContraBlanco: false },
  { marca: "#e17360", nota: "sucursal real: coral; contra blanco 3,08:1 (justo)", tinta: "oscura", pasaTexto: true, pasaContraBlanco: true },
  { marca: "#ffcb69", nota: "sucursal real: amarillo; contra blanco 1,50:1", tinta: "oscura", pasaTexto: true, pasaContraBlanco: false },
  { marca: "#000000", nota: "extremo oscuro", tinta: "clara", pasaTexto: true, pasaContraBlanco: true },
  { marca: "#ffffff", nota: "extremo claro: igual al fondo", tinta: "oscura", pasaTexto: true, pasaContraBlanco: false },
  { marca: "#1a237e", nota: "azul marino saturado", tinta: "clara", pasaTexto: true, pasaContraBlanco: true },
  { marca: "#d32f2f", nota: "rojo saturado; la tinta clara del sistema NO es blanco puro y llega a 4,42:1 (con blanco puro llegaría a 4,98)", tinta: "clara", pasaTexto: false, pasaContraBlanco: true },
  { marca: "#cddc39", nota: "lima saturado", tinta: "oscura", pasaTexto: true, pasaContraBlanco: false },
];

/** Cada clave de color del catálogo de la carta (tema por sucursal y portal por empresa) declara qué es en el modelo de marca. Un guardián falla si aparece una clave de color nueva sin declarar. */
export type DestinoDeClaveDeColor = "marca" | "se-retira-de-la-lectura";

export const CLAVES_DE_COLOR_DEL_TEMA: Readonly<Record<string, DestinoDeClaveDeColor>> = {
  color_marca: "marca",
  color_fondo_dia: "se-retira-de-la-lectura",
  hero_color_fondo: "se-retira-de-la-lectura",
  hero_ink: "se-retira-de-la-lectura",
  color_portada_textos: "se-retira-de-la-lectura",
  color_portada_cta: "se-retira-de-la-lectura",
  color_indice_titulo: "se-retira-de-la-lectura",
  color_indice_numeros: "se-retira-de-la-lectura",
  color_indice_titulos: "se-retira-de-la-lectura",
  color_banda_etiqueta: "se-retira-de-la-lectura",
  color_banda_titulo: "se-retira-de-la-lectura",
  color_banda_descripcion: "se-retira-de-la-lectura",
  color_item_nombre: "se-retira-de-la-lectura",
  color_item_precio: "se-retira-de-la-lectura",
  color_item_descripcion: "se-retira-de-la-lectura",
  color_item_tags: "se-retira-de-la-lectura",
  color_especial_item_nombre: "se-retira-de-la-lectura",
  color_especial_item_precio: "se-retira-de-la-lectura",
  color_especial_item_descripcion: "se-retira-de-la-lectura",
  color_especial_item_tags: "se-retira-de-la-lectura",
  color_nav_flechas: "se-retira-de-la-lectura",
  color_nav_iconos: "se-retira-de-la-lectura",
  topbar_back_color: "se-retira-de-la-lectura",
};

export const CLAVES_DE_COLOR_DEL_PORTAL: Readonly<Record<string, DestinoDeClaveDeColor>> = {
  portal_header_bg: "se-retira-de-la-lectura",
  portal_header_color: "se-retira-de-la-lectura",
  portal_etiqueta_color: "se-retira-de-la-lectura",
  portal_titulo_color: "se-retira-de-la-lectura",
  portal_fondo_color: "se-retira-de-la-lectura",
  portal_card_bg: "se-retira-de-la-lectura",
  portal_card_border: "se-retira-de-la-lectura",
  portal_card_border_hover: "se-retira-de-la-lectura",
  portal_card_color: "se-retira-de-la-lectura",
  portal_card_color_hover: "se-retira-de-la-lectura",
  portal_card_notas_color: "se-retira-de-la-lectura",
  portal_card_flecha_color: "se-retira-de-la-lectura",
};
