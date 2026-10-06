import { sanitizeCssColor } from "./color-css";
import {
  validarAltoBanda,
  validarEnum,
  validarOpacidad,
  validarPorcentaje,
  validarRedSocial,
  validarTamanoFuente,
  validarTelefono,
  validarUrlHttps,
} from "./css-valores";
import { validarImagenUrlCarta, validarTextoLibreCarta, type Resultado } from "./validaciones";

/**
 * Tema visual de la carta pública (docs/plan-tema-carta-2026-09-24.md, M3): `TemaCartaSucursal.valores`, un Json con las claves de
 * `SiteConfig` de la carta original (restaurant-menu-design).
 *
 * Puro, sin Prisma: lo importa también el editor de tema (cliente). El catálogo `CLAVES_TEMA_V1` es la única fuente de las 64
 * claves por tenant: alimenta la validación (Server Actions), el formulario y la vista previa (pantalla) y el contrato `TemaCartaV1` (lo arma
 * `armarTemaCarta` para la carta pública interna).
 *
 * De las 109 claves de `SiteConfig`:
 *  - 63 son por tenant y tienen efecto en /carta/[sucursal] → `CLAVES_TEMA_V1` (bloques A=6, B=23, C=9, D=25; D3 del plan). Más 1 propia de motor2, sin
 *    equivalente en `SiteConfig`: `carta_fuente_familia` (D=26) — la familia tipográfica de títulos, nombres y precios.
 *  - 4 están RETIRADAS (`CLAVES_RETIRADAS`): 1 que el original nunca dibujaba y las 3 de miniatura de la imagen de sección (decisión del dueño).
 *  - 3 son de precio y son CONVENCIÓN FIJA del sistema (es-AR, "$", a la izquierda) → `CLAVES_FIJAS_DEL_SISTEMA`: motor2 no las
 *    guarda ni las emite; la carta usa esa misma convención.
 *  - 39 no son por tenant (config raíz del portal, SEO, o solo del modo single de `/`) → `CLAVES_NO_POR_TENANT`.
 */

// ---------------------------------------------------------------------------------------------------------------------------
// Tipos de valor (tabla de D13)
// ---------------------------------------------------------------------------------------------------------------------------

export type TipoValorTema =
  | { tipo: "color" }
  | { tipo: "colorHeroInk" }
  | { tipo: "colorHex" }
  | { tipo: "tamanoFuente" }
  | { tipo: "altoBandaMobile" }
  | { tipo: "altoBandaDesktop" }
  | { tipo: "porcentaje" }
  | { tipo: "opacidad" }
  | { tipo: "enum"; opciones: readonly string[]; alias?: Readonly<Record<string, string>> }
  | { tipo: "redSocial"; red: "instagram" | "facebook" }
  | { tipo: "telefono" }
  | { tipo: "urlHttps" }
  | { tipo: "texto"; maximo: number }
  | { tipo: "imagen" };

export type BloqueTema = "A" | "B" | "C" | "D";

/** Las 15 zonas del formulario, en el orden en que se muestran. */
export const ZONAS_TEMA = [
  "Portada e identidad",
  "Colores generales",
  "Índice",
  "Banda de sección",
  "Ítems",
  "Ítems especiales",
  "Navegación y barra superior",
  "Textos fijos",
  "Contacto",
  "Tipografía general",
  "Tipografía de portada",
  "Tipografía de índice",
  "Tipografía de banda",
  "Tipografía de ítems",
  "Banda e imagen de sección",
] as const;
export type ZonaTema = (typeof ZONAS_TEMA)[number];

export type DefinicionClaveTema = TipoValorTema & {
  clave: string;
  bloque: BloqueTema;
  zona: ZonaTema;
  /** En castellano: la etiqueta del campo y el nombre en los mensajes de error. */
  etiqueta: string;
  /** El default de `SiteConfig` en restaurant-menu-design (lib/get-config.ts): placeholder del campo y base de la vista previa. "" = sin valor. */
  defaultCarta: string;
};

/** Familias tipográficas de la carta (`carta_fuente_familia`); la primera es el default. Cada una se carga con `next/font` en `fuente-carta.ts`. */
export const FAMILIAS_TIPOGRAFICAS = ["playfair", "lora", "cormorant", "montserrat", "geist"] as const;
export type FamiliaTipografica = (typeof FAMILIAS_TIPOGRAFICAS)[number];

const COLOR = { tipo: "color" } as const;
const FUENTE = { tipo: "tamanoFuente" } as const;
const texto = (maximo: number) => ({ tipo: "texto", maximo }) as const;

/** Las opciones "sí"/"no" de la carta: `isTruthy` de hero-utils para el sí; la carta apaga el overlay solo con "no". */
const ALIAS_SI_NO: Readonly<Record<string, string>> = { "sí": "si", true: "si", "1": "si", yes: "si", false: "no", "0": "no" };

/**
 * Las 64 claves por tenant (D3 menos las 4 retiradas de `CLAVES_RETIRADAS`, más `carta_fuente_familia`). El orden es el del formulario: por zona, y dentro de cada zona como se leen en la carta.
 */
export const CLAVES_TEMA_V1 = [
  // Portada e identidad (A + la posición del bloque y del CTA en la portada mobile)
  { clave: "restaurante_nombre", bloque: "A", zona: "Portada e identidad", etiqueta: "Nombre del restaurante", defaultCarta: "", ...texto(120) },
  { clave: "restaurante_subtitulo", bloque: "A", zona: "Portada e identidad", etiqueta: "Subtítulo", defaultCarta: "", ...texto(120) },
  { clave: "restaurante_descripcion", bloque: "A", zona: "Portada e identidad", etiqueta: "Descripción", defaultCarta: "", ...texto(500) },
  { clave: "hero_etiqueta_superior", bloque: "A", zona: "Portada e identidad", etiqueta: "Etiqueta sobre el nombre", defaultCarta: "", ...texto(120) },
  { clave: "restaurante_logo_url", bloque: "A", zona: "Portada e identidad", etiqueta: "URL del logo", defaultCarta: "", tipo: "imagen" },
  { clave: "hero_imagen_fondo_url", bloque: "A", zona: "Portada e identidad", etiqueta: "URL de la imagen de fondo de la portada", defaultCarta: "", tipo: "imagen" },
  { clave: "carta_pos_bloque", bloque: "D", zona: "Portada e identidad", etiqueta: "Posición vertical del bloque de portada en mobile (%)", defaultCarta: "50", tipo: "porcentaje" },
  { clave: "carta_pos_cta", bloque: "D", zona: "Portada e identidad", etiqueta: "Distancia del CTA al pie de la portada en mobile (%)", defaultCarta: "18", tipo: "porcentaje" },

  // Colores generales
  { clave: "color_marca", bloque: "B", zona: "Colores generales", etiqueta: "Color de marca (acento)", defaultCarta: "", ...COLOR },
  { clave: "color_fondo_dia", bloque: "B", zona: "Colores generales", etiqueta: "Color de fondo de la carta", defaultCarta: "", ...COLOR },
  { clave: "hero_color_fondo", bloque: "B", zona: "Colores generales", etiqueta: "Fondo de la portada (hex #rrggbb)", defaultCarta: "", tipo: "colorHex" },
  { clave: "hero_ink", bloque: "B", zona: "Colores generales", etiqueta: "Texto de la portada (claro, oscuro o un color)", defaultCarta: "", tipo: "colorHeroInk" },
  { clave: "color_portada_textos", bloque: "B", zona: "Colores generales", etiqueta: "Color de los textos de la portada", defaultCarta: "", ...COLOR },
  { clave: "color_portada_cta", bloque: "B", zona: "Colores generales", etiqueta: "Color del CTA de la portada", defaultCarta: "", ...COLOR },

  // Índice
  { clave: "color_indice_titulo", bloque: "B", zona: "Índice", etiqueta: "Color del título del índice", defaultCarta: "", ...COLOR },
  { clave: "color_indice_numeros", bloque: "B", zona: "Índice", etiqueta: "Color de los números del índice", defaultCarta: "", ...COLOR },
  { clave: "color_indice_titulos", bloque: "B", zona: "Índice", etiqueta: "Color de las secciones del índice", defaultCarta: "", ...COLOR },

  // Banda de sección
  { clave: "color_banda_etiqueta", bloque: "B", zona: "Banda de sección", etiqueta: "Color de la etiqueta de la banda", defaultCarta: "", ...COLOR },
  { clave: "color_banda_titulo", bloque: "B", zona: "Banda de sección", etiqueta: "Color del título de la banda", defaultCarta: "", ...COLOR },
  { clave: "color_banda_descripcion", bloque: "B", zona: "Banda de sección", etiqueta: "Color de la descripción de la banda", defaultCarta: "", ...COLOR },

  // Ítems
  { clave: "color_item_nombre", bloque: "B", zona: "Ítems", etiqueta: "Color del nombre del ítem", defaultCarta: "", ...COLOR },
  { clave: "color_item_precio", bloque: "B", zona: "Ítems", etiqueta: "Color del precio del ítem", defaultCarta: "", ...COLOR },
  { clave: "color_item_descripcion", bloque: "B", zona: "Ítems", etiqueta: "Color de la descripción del ítem", defaultCarta: "", ...COLOR },
  { clave: "color_item_tags", bloque: "B", zona: "Ítems", etiqueta: "Color de los tags del ítem", defaultCarta: "", ...COLOR },

  // Ítems especiales
  { clave: "color_especial_item_nombre", bloque: "B", zona: "Ítems especiales", etiqueta: "Color del nombre del ítem especial", defaultCarta: "", ...COLOR },
  { clave: "color_especial_item_precio", bloque: "B", zona: "Ítems especiales", etiqueta: "Color del precio del ítem especial", defaultCarta: "", ...COLOR },
  { clave: "color_especial_item_descripcion", bloque: "B", zona: "Ítems especiales", etiqueta: "Color de la descripción del ítem especial", defaultCarta: "", ...COLOR },
  { clave: "color_especial_item_tags", bloque: "B", zona: "Ítems especiales", etiqueta: "Color de los tags del ítem especial", defaultCarta: "", ...COLOR },

  // Navegación y barra superior
  { clave: "color_nav_flechas", bloque: "B", zona: "Navegación y barra superior", etiqueta: "Color de las flechas de la navegación", defaultCarta: "", ...COLOR },
  { clave: "color_nav_iconos", bloque: "B", zona: "Navegación y barra superior", etiqueta: "Color de los íconos de redes", defaultCarta: "", ...COLOR },
  { clave: "topbar_back_label", bloque: "C", zona: "Navegación y barra superior", etiqueta: "Texto del botón para volver", defaultCarta: "← Menú", ...texto(40) },
  { clave: "topbar_back_color", bloque: "B", zona: "Navegación y barra superior", etiqueta: "Color del botón para volver", defaultCarta: "", ...COLOR },
  { clave: "topbar_back_size", bloque: "D", zona: "Navegación y barra superior", etiqueta: "Tamaño del botón para volver", defaultCarta: "12px", ...FUENTE },

  // Textos fijos
  { clave: "carta_texto_portada_separador", bloque: "C", zona: "Textos fijos", etiqueta: "Texto del separador de la portada", defaultCarta: "", ...texto(10) },
  { clave: "carta_texto_portada_cta", bloque: "C", zona: "Textos fijos", etiqueta: "Texto del CTA de la portada", defaultCarta: "", ...texto(60) },
  { clave: "carta_texto_indice_etiqueta", bloque: "C", zona: "Textos fijos", etiqueta: "Texto de la etiqueta del índice", defaultCarta: "", ...texto(60) },
  { clave: "carta_texto_indice_titulo", bloque: "C", zona: "Textos fijos", etiqueta: "Texto del título del índice", defaultCarta: "", ...texto(120) },

  // Contacto
  { clave: "restaurante_instagram", bloque: "C", zona: "Contacto", etiqueta: "Instagram (usuario o URL)", defaultCarta: "", tipo: "redSocial", red: "instagram" },
  { clave: "restaurante_facebook", bloque: "C", zona: "Contacto", etiqueta: "Facebook (usuario o URL)", defaultCarta: "", tipo: "redSocial", red: "facebook" },
  { clave: "restaurante_whatsapp", bloque: "C", zona: "Contacto", etiqueta: "WhatsApp (teléfono con código de país)", defaultCarta: "", tipo: "telefono" },
  { clave: "restaurante_footer_maps_url", bloque: "C", zona: "Contacto", etiqueta: "Link de Google Maps", defaultCarta: "", tipo: "urlHttps" },

  // Tipografía general
  { clave: "carta_fuente_familia", bloque: "D", zona: "Tipografía general", etiqueta: "Tipografía de títulos, nombres y precios", defaultCarta: "playfair", tipo: "enum", opciones: FAMILIAS_TIPOGRAFICAS },

  // Tipografía de portada
  { clave: "carta_fuente_portada_etiqueta", bloque: "D", zona: "Tipografía de portada", etiqueta: "Tamaño de la etiqueta de la portada", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_portada_nombre", bloque: "D", zona: "Tipografía de portada", etiqueta: "Tamaño del nombre en la portada", defaultCarta: "clamp(1.7rem, 7vw, 2.1rem)", ...FUENTE },
  { clave: "carta_fuente_portada_subtitulo", bloque: "D", zona: "Tipografía de portada", etiqueta: "Tamaño del subtítulo de la portada", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_portada_descripcion", bloque: "D", zona: "Tipografía de portada", etiqueta: "Tamaño de la descripción de la portada", defaultCarta: "0.75rem", ...FUENTE },
  { clave: "carta_fuente_portada_cta", bloque: "D", zona: "Tipografía de portada", etiqueta: "Tamaño del CTA de la portada", defaultCarta: "0.6875rem", ...FUENTE },

  // Tipografía de índice
  { clave: "carta_fuente_indice_etiqueta", bloque: "D", zona: "Tipografía de índice", etiqueta: "Tamaño de la etiqueta del índice", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_indice_titulo", bloque: "D", zona: "Tipografía de índice", etiqueta: "Tamaño del título del índice", defaultCarta: "clamp(1.2rem, 4vw, 1.75rem)", ...FUENTE },
  { clave: "carta_fuente_indice_numero", bloque: "D", zona: "Tipografía de índice", etiqueta: "Tamaño de los números del índice", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_indice_item", bloque: "D", zona: "Tipografía de índice", etiqueta: "Tamaño de las secciones del índice", defaultCarta: "clamp(0.82rem, 2.5vw, 0.95rem)", ...FUENTE },

  // Tipografía de banda
  { clave: "carta_fuente_banda_etiqueta", bloque: "D", zona: "Tipografía de banda", etiqueta: "Tamaño de la etiqueta de la banda", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_banda_titulo", bloque: "D", zona: "Tipografía de banda", etiqueta: "Tamaño del título de la banda", defaultCarta: "0.95rem", ...FUENTE },
  { clave: "carta_fuente_banda_descripcion", bloque: "D", zona: "Tipografía de banda", etiqueta: "Tamaño de la descripción de la banda", defaultCarta: "0.6875rem", ...FUENTE },

  // Tipografía de ítems
  { clave: "carta_fuente_item_nombre", bloque: "D", zona: "Tipografía de ítems", etiqueta: "Tamaño del nombre del ítem", defaultCarta: "0.88rem", ...FUENTE },
  { clave: "carta_fuente_item_precio", bloque: "D", zona: "Tipografía de ítems", etiqueta: "Tamaño del precio del ítem", defaultCarta: "0.88rem", ...FUENTE },
  { clave: "carta_fuente_item_descripcion", bloque: "D", zona: "Tipografía de ítems", etiqueta: "Tamaño de la descripción del ítem", defaultCarta: "0.6875rem", ...FUENTE },
  { clave: "carta_fuente_item_tags", bloque: "D", zona: "Tipografía de ítems", etiqueta: "Tamaño de los tags del ítem", defaultCarta: "0.6875rem", ...FUENTE },

  // Banda e imagen de sección
  { clave: "carta_banda_alto_mobile", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Alto de la banda en mobile", defaultCarta: "90", tipo: "altoBandaMobile" },
  { clave: "carta_banda_alto_desktop", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Alto de la banda en desktop", defaultCarta: "clamp(80px, 18vh, 140px)", tipo: "altoBandaDesktop" },
  { clave: "carta_imagen_pos_x", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Posición horizontal de la imagen", defaultCarta: "left", tipo: "enum", opciones: ["left", "center", "right"] },
  { clave: "carta_imagen_pos_y", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Posición vertical de la imagen", defaultCarta: "top", tipo: "enum", opciones: ["top", "center", "bottom"] },
  { clave: "carta_imagen_overlay", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Degradé sobre la imagen", defaultCarta: "si", tipo: "enum", opciones: ["si", "no"], alias: ALIAS_SI_NO },
  { clave: "carta_imagen_opacidad", bloque: "D", zona: "Banda e imagen de sección", etiqueta: "Opacidad de la imagen (1 a 100)", defaultCarta: "38", tipo: "opacidad" },
] as const satisfies readonly DefinicionClaveTema[];

export type ClaveTema = (typeof CLAVES_TEMA_V1)[number]["clave"];

const DEFINICION_POR_CLAVE: ReadonlyMap<string, DefinicionClaveTema> = new Map(CLAVES_TEMA_V1.map((d) => [d.clave, d as DefinicionClaveTema]));

function definicionClaveTema(clave: string): DefinicionClaveTema | undefined {
  return DEFINICION_POR_CLAVE.get(clave);
}

export function esClaveTema(clave: string): clave is ClaveTema {
  return DEFINICION_POR_CLAVE.has(clave);
}

/**
 * Las 3 claves de precio: convención fija del sistema argentino (decisión del dueño). No están en el editor ni en el contrato;
 * la carta usa este valor. Lo usa `precio-carta.ts` para formatear los precios.
 */
export const CLAVES_FIJAS_DEL_SISTEMA = { precio_locale: "es-AR", precio_simbolo: "$", precio_posicion: "izquierda" } as const;

/**
 * Claves de `SiteConfig` que existían en el catálogo y se retiraron. `carta_fuente_indice_categoria` nunca tuvo efecto visual
 * (ni en la carta original ni en la interna). Las 3 `carta_imagen_*` de miniatura (modo, alto mobile, tamaño desktop) se
 * retiraron por decisión del dueño: la imagen de sección se dibuja siempre como fondo de la banda. Se conservan solo para el test de paridad
 * con `SiteConfig`.
 */
export const CLAVES_RETIRADAS = ["carta_fuente_indice_categoria", "carta_imagen_modo", "carta_imagen_ancho_mobile", "carta_imagen_ancho_desktop"] as const;

/**
 * Las 39 claves de `SiteConfig` que NO son por tenant (A.1/A.2 del plan): la carta las lee de la config raíz (portal, SEO,
 * metadata) o solo las dibuja en el modo single de `/`. Las del portal por empresa ya no son un pendiente: viven en
 * `CLAVES_PORTAL_V1` (`portal.ts`, tabla `PortalCartaEmpresa`); lo que sigue acá es config raíz/SEO y el modo single.
 */
export const CLAVES_NO_POR_TENANT = [
  // Solo en MenuHero (modo single de /)
  "restaurante_boton_hero",
  "hero_etiqueta_scroll",
  "hero_pos_contenido",
  "hero_pos_contenido_mobile",
  "hero_pos_logo",
  "hero_pos_logo_mobile",
  // Colores semánticos de menu-section/menu-nav (modo single de /)
  "color_nav",
  "color_seccion",
  "color_especial",
  "color_cta",
  "color_tags",
  "color_precio",
  // Raíz: metadata, manifest y SEO
  "theme_color",
  "favicon_url",
  "lang",
  "meta_title",
  "meta_descripcion",
  "meta_og_image_url",
  "meta_og_locale",
  "meta_og_url",
  "meta_twitter_card",
  // Raíz: pertenencia y portal
  "empresa_nombre",
  "empresa_logo_url",
  "portal_etiqueta",
  "portal_titulo",
  "portal_titulo_color",
  "portal_bg_image_url",
  "portal_bg_overlay",
  "portal_card_color",
  "portal_card_color_hover",
  "portal_card_border_hover",
  "portal_header_bg",
  "portal_header_color",
  "portal_etiqueta_color",
  "portal_card_bg",
  "portal_card_border",
  "portal_card_notas_color",
  "portal_card_flecha_color",
  "footer_texto_derechos",
] as const;

// ---------------------------------------------------------------------------------------------------------------------------
// Contrato v1 (tema de la carta pública interna)
// ---------------------------------------------------------------------------------------------------------------------------

/** Valores cargados (normalizados) por clave del catálogo. Una clave ausente = vacía (default de la carta). */
export type ValoresTema = Partial<Record<ClaveTema, string>>;

export interface TemaCartaV1 {
  version: 1;
  generadoEn: string;
  sucursalId: string;
  actualizadoEn: string;
  /** SIEMPRE las 64 claves del catálogo; `null` = no cargada (la carta usa su default). */
  valores: Record<ClaveTema, string | null>;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------------------------------------------------------

const MAXIMO_COLOR = 100;
const RE_CONTROL = /[\u0000-\u001f\u007f]/;
const MAXIMO_ERRORES_JUNTOS = 5;

function validarColor(v: string, definicion: TipoValorTema): Resultado<string> {
  if (v.length > MAXIMO_COLOR) return { ok: false, mensaje: `no puede superar los ${MAXIMO_COLOR} caracteres` };
  const lower = v.toLowerCase();
  if (definicion.tipo === "colorHeroInk" && (lower === "claro" || lower === "oscuro")) return { ok: true, valor: lower };
  if (lower === "claro" || lower === "oscuro") return { ok: false, mensaje: "«claro» y «oscuro» solo valen para el texto de la portada" };
  if (definicion.tipo === "colorHex") {
    const h3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
    if (h3) return { ok: true, valor: `#${h3[1]}${h3[1]}${h3[2]}${h3[2]}${h3[3]}${h3[3]}`.toLowerCase() };
    if (/^#[0-9a-f]{6}$/i.test(v)) return { ok: true, valor: v.toLowerCase() };
    return { ok: false, mensaje: "tiene que ser un color hex #rgb o #rrggbb (la carta le suma transparencia al final)" };
  }
  // Mismo criterio que la carta: `sanitizeCssColor` (resolveHeroInk, para hero_ink, solo agrega los alias de arriba).
  const limpio = sanitizeCssColor(v);
  if (limpio === null) return { ok: false, mensaje: "no es un color CSS válido (ej. #8b4513, rgb(…), hsl(…), oklch(…) o un nombre como red)" };
  return { ok: true, valor: limpio };
}

/**
 * Valida un valor YA recortado y no vacío contra el tipo de una definición. Es la pieza que comparten el tema de la sucursal
 * (`CLAVES_TEMA_V1`) y la config del portal (`portal.ts`): el que llama decide qué hace con el vacío y con la clave.
 */
export function validarValorDefinicion(v: string, d: TipoValorTema & { etiqueta: string }): Resultado<string> {
  switch (d.tipo) {
    case "color":
    case "colorHeroInk":
    case "colorHex":
      return validarColor(v, d);
    case "tamanoFuente":
      return validarTamanoFuente(v);
    case "altoBandaMobile":
      return validarAltoBanda(v, { normalizarPx: false });
    case "altoBandaDesktop":
      return validarAltoBanda(v, { normalizarPx: true });
    case "porcentaje":
      return validarPorcentaje(v);
    case "opacidad":
      return validarOpacidad(v);
    case "enum":
      return validarEnum(v, d.opciones, d.alias);
    case "redSocial":
      return validarRedSocial(v, d.red);
    case "telefono":
      return validarTelefono(v);
    case "urlHttps":
      return validarUrlHttps(v);
    case "texto": {
      if (RE_CONTROL.test(v)) return { ok: false, mensaje: "tiene caracteres de control (saltos de línea, tabulaciones…)" };
      const r = validarTextoLibreCarta(v, d.etiqueta, d.maximo);
      if (!r.ok) return { ok: false, mensaje: `no puede superar los ${d.maximo} caracteres` };
      return { ok: true, valor: r.valor ?? "" };
    }
    case "imagen": {
      const r = validarImagenUrlCarta(v);
      if (!r.ok) return { ok: false, mensaje: "tiene que ser una URL https:// sin espacios, comillas ni paréntesis" };
      return { ok: true, valor: r.valor ?? "" };
    }
  }
}

/**
 * Valida y normaliza el valor de UNA clave del catálogo. Vacío (o solo espacios) → `null` (= default de la carta). Una clave
 * fuera del catálogo es un error. El mensaje de error NO lleva la etiqueta (la agrega `validarValoresTema`).
 */
export function validarValorTema(clave: string, valor: unknown): Resultado<string | null> {
  const d = definicionClaveTema(clave);
  if (!d) return { ok: false, mensaje: "no es una clave del tema de la carta" };
  if (typeof valor !== "string") return { ok: false, mensaje: "tiene que ser texto" };
  const v = valor.trim();
  if (!v) return { ok: true, valor: null };
  return validarValorDefinicion(v, d);
}

/**
 * Valida todo lo que llega del formulario: solo las claves del catálogo (el resto, incluidas las `precio_*`, se ignora), los
 * vacíos se omiten. Devuelve los valores normalizados o, si hay errores, hasta 5 juntos en un solo mensaje con la etiqueta en
 * castellano de cada campo.
 */
export function validarValoresTema(entrada: Readonly<Record<string, unknown>>): Resultado<ValoresTema> {
  const valores: ValoresTema = {};
  const errores: string[] = [];
  for (const d of CLAVES_TEMA_V1) {
    if (!Object.hasOwn(entrada, d.clave)) continue;
    const crudo = entrada[d.clave];
    if (crudo === null || crudo === undefined) continue;
    const r = validarValorTema(d.clave, typeof crudo === "number" ? String(crudo) : crudo);
    if (!r.ok) errores.push(`${d.etiqueta}: ${r.mensaje}`);
    else if (r.valor !== null) valores[d.clave] = r.valor;
  }
  if (errores.length) {
    const extra = errores.length > MAXIMO_ERRORES_JUNTOS ? ` (y ${errores.length - MAXIMO_ERRORES_JUNTOS} más)` : "";
    return { ok: false, mensaje: `Revisá ${errores.length === 1 ? "este campo" : "estos campos"}: ${errores.slice(0, MAXIMO_ERRORES_JUNTOS).join(" · ")}${extra}.` };
  }
  return { ok: true, valor: valores };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Armado de la salida (endpoint)
// ---------------------------------------------------------------------------------------------------------------------------

/** Lo que `resolverTemaCarta` lee de `TemaCartaSucursal`. `valores` es el Json tal cual está en la base. */
export interface FilaTemaCarta {
  sucursalId: string;
  valores: unknown;
  actualizadoEn: Date;
}

/**
 * Arma `TemaCartaV1` desde la fila, VOLVIENDO A VALIDAR cada valor del Json (una carga por `db:studio` no pasa por las Server
 * Actions): emite siempre las 64 claves del catálogo; un valor inválido, que no es texto o que no está → `null`. Las claves
 * ajenas al catálogo se ignoran (incluidas las `precio_*`, si alguien las cargara a mano).
 */
export function armarTemaCarta(fila: FilaTemaCarta, ahora: Date = new Date()): TemaCartaV1 {
  const json = fila.valores;
  const obj: Record<string, unknown> = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const valores = {} as Record<ClaveTema, string | null>;
  for (const d of CLAVES_TEMA_V1) {
    const crudo = Object.hasOwn(obj, d.clave) ? obj[d.clave] : undefined;
    const r = typeof crudo === "string" ? validarValorTema(d.clave, crudo) : null;
    valores[d.clave] = r && r.ok ? r.valor : null;
  }
  return { version: 1, generadoEn: ahora.toISOString(), sucursalId: fila.sucursalId, actualizadoEn: fila.actualizadoEn.toISOString(), valores };
}

/** Cuántas claves del catálogo tienen valor válido en el Json guardado (0 = tema vacío: no se puede aplicar). */
export function contarValoresTema(valores: unknown): number {
  return Object.values(armarTemaCarta({ sucursalId: "", valores, actualizadoEn: new Date(0) }, new Date(0)).valores).filter((v) => v !== null).length;
}
