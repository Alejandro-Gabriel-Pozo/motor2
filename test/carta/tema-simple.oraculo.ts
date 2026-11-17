import { CLAVES_TEMA_V1, type DefinicionClaveTema } from "../../src/core/carta/tema";

/**
 * ORÁCULO de la pantalla simple del Tema de la carta (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`, §2.2 y §7): las reglas esperadas, escritas aparte del código y a mano,
 * contra las que corren `tema-simple.test.ts` (puro) y `acciones-tema-simple.test.ts` (con la base). Nada de lo de acá se calcula con el código que se prueba.
 *
 * Qué pasa con cada una de las 65 claves del Tema (la tabla campo por campo del diseño, columna «Decisión»):
 *  - SIMPLE: la pide la pantalla simple (el dueño, 2026-11-17: «Te pedía color de marca nada más», «lo del contacto sí»; el logo y el nombre, según Pedernal).
 *  - DERIVADA: la pantalla ya no la pide; la da el sistema (colores fijos sobre el fondo oscuro o la maqueta). Lo ya cargado sigue mandando. (`marca_derivada` es el marcador que escribe la pantalla simple.)
 *  - PENDIENTE: falta la palabra del dueño (rubro, lema, descripción, imagen de portada): no se muestra y lo cargado sigue mandando.
 *  - ESCONDIDA: la tipografía general, también pendiente del dueño (¿sans o serifa?): no se muestra.
 *
 * REGLA DE COLOR (dueño, 2026-11-17: «Ve como un pedernal.»; Pedernal `ui/tokens.css`, «Acción y acento: lo único que sale de la marca»): con el marcador «oscura» el TEXTO y los ÍCONOS de la carta (tinta, texto de lo que antes
 * se pintaba con la marca, flechas, íconos de redes, invitación y letra del sello) salen de colores FIJOS del sistema a 7:1 o más sobre el fondo, IGUALES con cualquier marca; la marca queda solo en acentos y bordes y se muestra tal cual
 * (sin ajuste de luminosidad ni aviso). Como acento puede quedar bajo 3:1 contra el fondo (colores muy oscuros): se declara, no se rechaza.
 * Una clave NUEVA del catálogo sin entrada acá rompe `tema-simple.test.ts`: hay que declarar si afecta o no a la pantalla simple.
 */
export type DestinoDeClave = "SIMPLE" | "DERIVADA" | "PENDIENTE" | "ESCONDIDA";

export const CLAVES_POR_DESTINO: Readonly<Record<DestinoDeClave, readonly string[]>> = {
  SIMPLE: ["color_marca", "restaurante_logo_url", "restaurante_nombre", "restaurante_instagram", "restaurante_facebook", "restaurante_whatsapp", "restaurante_footer_maps_url"],
  PENDIENTE: ["restaurante_subtitulo", "restaurante_descripcion", "hero_etiqueta_superior", "hero_imagen_fondo_url"],
  ESCONDIDA: ["carta_fuente_familia"],
  DERIVADA: [
    // Portada y colores generales
    "carta_pos_bloque", "carta_pos_cta", "marca_derivada", "color_fondo_dia", "hero_color_fondo", "hero_ink", "color_portada_textos", "color_portada_cta",
    // Índice, banda, ítems e ítems especiales
    "color_indice_titulo", "color_indice_numeros", "color_indice_titulos", "color_banda_etiqueta", "color_banda_titulo", "color_banda_descripcion",
    "color_item_nombre", "color_item_precio", "color_item_descripcion", "color_item_tags",
    "color_especial_item_nombre", "color_especial_item_precio", "color_especial_item_descripcion", "color_especial_item_tags",
    // Navegación y barra superior, textos fijos
    "color_nav_flechas", "color_nav_iconos", "topbar_back_label", "topbar_back_color", "topbar_back_size",
    "carta_texto_portada_separador", "carta_texto_portada_cta", "carta_texto_indice_etiqueta", "carta_texto_indice_titulo",
    // Tamaños de letra
    "carta_fuente_portada_etiqueta", "carta_fuente_portada_nombre", "carta_fuente_portada_subtitulo", "carta_fuente_portada_descripcion", "carta_fuente_portada_cta",
    "carta_fuente_indice_etiqueta", "carta_fuente_indice_titulo", "carta_fuente_indice_numero", "carta_fuente_indice_item",
    "carta_fuente_banda_etiqueta", "carta_fuente_banda_titulo", "carta_fuente_banda_descripcion",
    "carta_fuente_item_nombre", "carta_fuente_item_precio", "carta_fuente_item_descripcion", "carta_fuente_item_tags",
    // Banda e imagen de sección
    "carta_banda_alto_mobile", "carta_banda_alto_desktop", "carta_imagen_pos_x", "carta_imagen_pos_y", "carta_imagen_overlay", "carta_imagen_opacidad",
  ],
};

/** Un valor válido por clave (el default de la carta si lo hay, si no uno de muestra según el tipo): para sembrar un tema con TODO cargado. */
function valorDeMuestra(d: DefinicionClaveTema): string {
  if (d.defaultCarta) return d.defaultCarta;
  switch (d.tipo) {
    case "color":
      return "#123456";
    case "colorHeroInk":
      return "claro";
    case "colorHex":
      return "#aabbcc";
    case "texto":
      return "Texto";
    case "imagen":
      return "https://cdn.example.com/x.png";
    case "redSocial":
      return "laparrilla";
    case "telefono":
      return "5492941234567";
    case "urlHttps":
      return "https://maps.app.goo.gl/x";
    case "enum":
      return d.opciones[0]!;
    default:
      throw new Error(`sin muestra para ${d.clave}`);
  }
}

/** Todo cargado: las 58 claves que NO son de la pantalla simple, con un valor válido (más un color de fondo propio para que se note). */
export const TODO_LO_AJENO_CARGADO: Readonly<Record<string, string>> = Object.fromEntries(
  CLAVES_TEMA_V1.filter((d) => !CLAVES_POR_DESTINO.SIMPLE.includes(d.clave)).map((d) => [d.clave, valorDeMuestra(d as DefinicionClaveTema)]),
);
/** Algunas cargadas (un grupo de colores, un texto y un tamaño). */
export const ALGO_AJENO_CARGADO: Readonly<Record<string, string>> = {
  color_fondo_dia: "#222222",
  color_item_nombre: "#eeeeee",
  hero_ink: "claro",
  restaurante_subtitulo: "Sabores de la cordillera",
  carta_fuente_item_nombre: "1.3rem",
  topbar_back_label: "← Volver",
};

/** Los colores de la prueba: las 6 paletas de Pedernal y los extremos que más rompen un contraste (todos `#rrggbb`). */
export const PALETAS_ESPERADAS: Readonly<Record<string, string>> = { azul: "#1f4e79", verde: "#17562f", bordo: "#7a1f2b", tostado: "#6b3f1d", negro: "#1b1f24", violeta: "#4b2e83" };
export const EXTREMOS: readonly string[] = [
  "#ffffff", // blanco
  "#000000", // negro
  "#ffff99", // amarillo claro
  "#ffeb3b", // amarillo fuerte
  "#000033", // azul muy oscuro
  "#0a0a0a", // casi negro
  "#808080", // gris medio
  "#7f7f7f", // gris medio, un punto menos
  "#d0d0d0", // gris claro
  "#19191a", // el mismo fondo oscuro del sistema
  "#ff0000", // rojo puro
  "#00ff00", // verde puro
  "#ffff00", // amarillo puro
];

/** La razón de contraste WCAG 2.1, escrita acá de nuevo (no la del código): de 1 a 21. */
export function contrasteWcag(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const lum = ([r, g, bl]: readonly [number, number, number]) => {
    const f = (c: number) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const hexACanales = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
