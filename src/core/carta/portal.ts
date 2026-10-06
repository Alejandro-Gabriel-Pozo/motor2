import { validarValorDefinicion, type TipoValorTema } from "./tema";
import type { Resultado } from "./validaciones";

/**
 * Portal de sucursales de una empresa (ADR-006): lo que en restaurant-menu-design era la config RAÍZ del portal (las claves
 * `portal_*`, `empresa_logo_url`, `footer_texto_derechos` y el fondo de la hoja maestra), pasado a motor2 como
 * `PortalCartaEmpresa.valores` (un Json por empresa, no por sucursal). El nombre de la empresa sale de `Empresa.nombre`, no de
 * la config.
 *
 * PURO, sin Prisma: lo importa también el editor del portal (cliente). El catálogo `CLAVES_PORTAL_V1` es la única fuente de las
 * claves: alimenta la validación (Server Action), el formulario, la vista previa y la resolución a variables CSS.
 *
 * Modo mapa: hay imagen de fondo Y al menos una sucursal con posición completa (`posX`, `posY`, `posW`; `posH` es opcional).
 * Si falta cualquiera de las dos cosas, el portal es una grilla. Las sucursales sin posición, en modo mapa, se listan en una
 * grilla debajo del mapa para que ninguna quede sin link.
 */

export type TipoValorPortal = TipoValorTema | { tipo: "fraccion" } | { tipo: "proporcion" };

export const ZONAS_PORTAL = ["Encabezado y títulos", "Fondo y mapa", "Tarjetas", "Pie"] as const;
export type ZonaPortal = (typeof ZONAS_PORTAL)[number];

export type DefinicionClavePortal = TipoValorPortal & {
  clave: string;
  zona: ZonaPortal;
  /** En castellano: la etiqueta del campo y el nombre en los mensajes de error. */
  etiqueta: string;
  /** El valor que se usa sin nada cargado. "" = sin valor (el CSS base de la carta decide). */
  defaultPortal: string;
};

const COLOR = { tipo: "color" } as const;
const IMAGEN = { tipo: "imagen" } as const;
const FUENTE = { tipo: "tamanoFuente" } as const;

export const PROPORCION_MAPA_POR_DEFECTO = "1080/1533";
const ALTO_TARJETA_POR_DEFECTO = 6;

/** El orden es el del formulario: por zona, y dentro de cada zona como se lee el portal. */
export const CLAVES_PORTAL_V1 = [
  { clave: "empresa_logo_url", zona: "Encabezado y títulos", etiqueta: "URL del logo de la empresa", defaultPortal: "", ...IMAGEN },
  { clave: "portal_header_bg", zona: "Encabezado y títulos", etiqueta: "Fondo del encabezado", defaultPortal: "", ...COLOR },
  { clave: "portal_header_color", zona: "Encabezado y títulos", etiqueta: "Color del texto del encabezado", defaultPortal: "", ...COLOR },
  { clave: "portal_etiqueta", zona: "Encabezado y títulos", etiqueta: "Etiqueta sobre el título", defaultPortal: "", tipo: "texto", maximo: 120 },
  { clave: "portal_etiqueta_color", zona: "Encabezado y títulos", etiqueta: "Color de la etiqueta", defaultPortal: "", ...COLOR },
  { clave: "portal_titulo", zona: "Encabezado y títulos", etiqueta: "Título del portal", defaultPortal: "", tipo: "texto", maximo: 120 },
  { clave: "portal_titulo_color", zona: "Encabezado y títulos", etiqueta: "Color del título", defaultPortal: "", ...COLOR },

  { clave: "portal_fondo_color", zona: "Fondo y mapa", etiqueta: "Color de fondo del portal", defaultPortal: "", ...COLOR },
  { clave: "portal_bg_image_url", zona: "Fondo y mapa", etiqueta: "URL de la imagen del mapa", defaultPortal: "", ...IMAGEN },
  { clave: "portal_bg_proporcion", zona: "Fondo y mapa", etiqueta: "Proporción del mapa (ancho/alto, ej. 1080/1533)", defaultPortal: PROPORCION_MAPA_POR_DEFECTO, tipo: "proporcion" },
  { clave: "portal_bg_overlay", zona: "Fondo y mapa", etiqueta: "Oscurecer la imagen (0 a 1)", defaultPortal: "0", tipo: "fraccion" },

  { clave: "portal_card_bg", zona: "Tarjetas", etiqueta: "Fondo de la tarjeta", defaultPortal: "", ...COLOR },
  { clave: "portal_card_border", zona: "Tarjetas", etiqueta: "Borde de la tarjeta", defaultPortal: "", ...COLOR },
  { clave: "portal_card_border_hover", zona: "Tarjetas", etiqueta: "Borde al pasar el mouse", defaultPortal: "", ...COLOR },
  { clave: "portal_card_color", zona: "Tarjetas", etiqueta: "Color del nombre", defaultPortal: "", ...COLOR },
  { clave: "portal_card_color_hover", zona: "Tarjetas", etiqueta: "Color del nombre al pasar el mouse", defaultPortal: "", ...COLOR },
  { clave: "portal_card_notas_color", zona: "Tarjetas", etiqueta: "Color del subtítulo", defaultPortal: "", ...COLOR },
  { clave: "portal_card_flecha_color", zona: "Tarjetas", etiqueta: "Color de la flecha", defaultPortal: "", ...COLOR },
  { clave: "portal_card_fuente_label", zona: "Tarjetas", etiqueta: "Tamaño del nombre", defaultPortal: "clamp(0.75rem, 2.2vw, 0.95rem)", ...FUENTE },
  { clave: "portal_card_fuente_notas", zona: "Tarjetas", etiqueta: "Tamaño del subtítulo", defaultPortal: "clamp(0.7rem, 1.8vw, 0.75rem)", ...FUENTE },
  { clave: "portal_card_alto_defecto", zona: "Tarjetas", etiqueta: "Alto de la tarjeta sobre el mapa cuando la sucursal no lo define (% del mapa)", defaultPortal: String(ALTO_TARJETA_POR_DEFECTO), tipo: "porcentaje" },

  { clave: "footer_texto_derechos", zona: "Pie", etiqueta: "Texto de derechos (se antepone © y el año)", defaultPortal: "", tipo: "texto", maximo: 120 },
] as const satisfies readonly DefinicionClavePortal[];

export type ClavePortal = (typeof CLAVES_PORTAL_V1)[number]["clave"];
export type ValoresPortal = Partial<Record<ClavePortal, string>>;

const DEFINICION_POR_CLAVE: ReadonlyMap<string, DefinicionClavePortal> = new Map(CLAVES_PORTAL_V1.map((d) => [d.clave, d as DefinicionClavePortal]));

export function esClavePortal(clave: string): clave is ClavePortal {
  return DEFINICION_POR_CLAVE.has(clave);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * La URL de una imagen tal como se copia de un documento: `[texto](https://…)` (link de markdown), `(https://…)` o la URL
 * pelada. Los paréntesis no pasan `validarImagenUrlCarta`, así que se sacan ANTES de validar.
 */
export function extraerUrlImagen(crudo: string): string {
  const s = crudo.trim();
  const md = /\[[^\]]*\]\(([^)]+)\)/.exec(s);
  if (md) return md[1].trim();
  const parentesis = /^\(([^()]+)\)$/.exec(s);
  if (parentesis) return parentesis[1].trim();
  return s;
}

const MENSAJE_FRACCION = "tiene que ser un número entre 0 y 1 (ej. 0.4)";
const MENSAJE_PROPORCION = "tiene que ser ancho/alto (ej. 1080/1533) o un número entre 0.2 y 5";
const PROPORCION_MINIMA = 0.2;
const PROPORCION_MAXIMA = 5;

function validarFraccion(v: string): Resultado<string> {
  if (!/^(?:0|1|0?\.\d{1,2}|1\.0{1,2})$/.test(v)) return { ok: false, mensaje: MENSAJE_FRACCION };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return { ok: false, mensaje: MENSAJE_FRACCION };
  return { ok: true, valor: String(n) };
}

function validarProporcion(v: string): Resultado<string> {
  const par = /^(\d{1,5})\s*[/:x]\s*(\d{1,5})$/i.exec(v);
  if (par) {
    const ancho = Number(par[1]);
    const alto = Number(par[2]);
    const razon = alto > 0 ? ancho / alto : 0;
    if (razon < PROPORCION_MINIMA || razon > PROPORCION_MAXIMA) return { ok: false, mensaje: MENSAJE_PROPORCION };
    return { ok: true, valor: `${ancho}/${alto}` };
  }
  if (/^\d{1,2}(?:\.\d{1,4})?$/.test(v)) {
    const n = Number(v);
    if (n >= PROPORCION_MINIMA && n <= PROPORCION_MAXIMA) return { ok: true, valor: String(n) };
  }
  return { ok: false, mensaje: MENSAJE_PROPORCION };
}

/** Valida y normaliza el valor de UNA clave. Vacío (o solo espacios) → `null` (= default). El mensaje NO lleva la etiqueta. */
export function validarValorPortal(clave: string, valor: unknown): Resultado<string | null> {
  const d = DEFINICION_POR_CLAVE.get(clave);
  if (!d) return { ok: false, mensaje: "no es una clave de la config del portal" };
  if (typeof valor !== "string") return { ok: false, mensaje: "tiene que ser texto" };
  const v = valor.trim();
  if (!v) return { ok: true, valor: null };
  if (d.tipo === "fraccion") return validarFraccion(v);
  if (d.tipo === "proporcion") return validarProporcion(v);
  return validarValorDefinicion(d.tipo === "imagen" ? extraerUrlImagen(v) : v, d);
}

const MAXIMO_ERRORES_JUNTOS = 5;

/**
 * Valida todo lo que llega del formulario: solo las claves del catálogo (el resto se ignora), los vacíos se omiten. Devuelve
 * los valores normalizados o, si hay errores, hasta 5 juntos en un solo mensaje con la etiqueta de cada campo.
 */
export function validarValoresPortal(entrada: Readonly<Record<string, unknown>>): Resultado<ValoresPortal> {
  const valores: ValoresPortal = {};
  const errores: string[] = [];
  for (const d of CLAVES_PORTAL_V1) {
    if (!Object.hasOwn(entrada, d.clave)) continue;
    const crudo = entrada[d.clave];
    if (crudo === null || crudo === undefined) continue;
    const r = validarValorPortal(d.clave, typeof crudo === "number" ? String(crudo) : crudo);
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
// Resolución a algo dibujable
// ---------------------------------------------------------------------------------------------------------------------------

export interface EstiloPortal {
  /** `--portal-<clave-con-guiones>` para las claves de color, tamaño de fuente y porcentaje del catálogo (las `portal_*`). */
  variablesCss: Readonly<Record<string, string>>;
  /** Todas las claves ya resueltas: valor validado o default del catálogo. */
  valores: Readonly<Record<ClavePortal, string>>;
  /** URL de la imagen del mapa, o `null` si no hay. */
  imagenFondo: string | null;
  /** 0 a 1. */
  overlay: number;
  /** Valor CSS de `aspect-ratio` ("1080/1533" o "0.7"). */
  proporcion: string;
  /** Alto por defecto de una tarjeta sobre el mapa, % del alto del mapa. */
  altoTarjetaPct: number;
}

/** `portal_card_bg` → `--portal-card-bg`. Solo las que empiezan con `portal_`; el resto (logo, derechos) no es CSS. */
function aVariableCss(clave: string): string | null {
  return clave.startsWith("portal_") ? `--${clave.replace(/_/g, "-")}` : null;
}

function normalizarFuente(v: string): string {
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
}

function valorResuelto(obj: Record<string, unknown>, d: DefinicionClavePortal): string {
  const crudo = Object.hasOwn(obj, d.clave) ? obj[d.clave] : undefined;
  const r = typeof crudo === "string" ? validarValorPortal(d.clave, crudo) : null;
  const v = r && r.ok && r.valor !== null ? r.valor : d.defaultPortal;
  return d.tipo === "tamanoFuente" ? normalizarFuente(v) : v;
}

/**
 * Resuelve el Json guardado de `PortalCartaEmpresa.valores`. VUELVE a validar cada valor (una carga por `db:studio` no pasa
 * por la Server Action): lo inválido, ausente o vacío cae al default del catálogo. Sin config (`{}`), el estilo por defecto.
 */
export function resolverEstiloPortal(valoresGuardados: unknown): EstiloPortal {
  const obj: Record<string, unknown> =
    typeof valoresGuardados === "object" && valoresGuardados !== null && !Array.isArray(valoresGuardados) ? (valoresGuardados as Record<string, unknown>) : {};

  const valores = {} as Record<ClavePortal, string>;
  const variablesCss: Record<string, string> = {};
  for (const d of CLAVES_PORTAL_V1) {
    const v = valorResuelto(obj, d);
    valores[d.clave] = v;
    const variable = aVariableCss(d.clave);
    if (variable && v && (d.tipo === "color" || d.tipo === "tamanoFuente" || d.tipo === "porcentaje")) variablesCss[variable] = v;
  }

  const overlay = Math.max(0, Math.min(1, Number(valores.portal_bg_overlay) || 0));
  const altoTarjetaPct = Number(valores.portal_card_alto_defecto);
  return {
    variablesCss,
    valores,
    imagenFondo: valores.portal_bg_image_url || null,
    overlay,
    proporcion: valores.portal_bg_proporcion,
    altoTarjetaPct: altoTarjetaPct > 0 ? altoTarjetaPct : ALTO_TARJETA_POR_DEFECTO,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Layout: mapa o grilla
// ---------------------------------------------------------------------------------------------------------------------------

/** Posición de la tarjeta sobre el mapa, % 0-100 del CENTRO; `h` opcional (default `EstiloPortal.altoTarjetaPct`). */
export interface PosicionPortal {
  x: number;
  y: number;
  w: number;
  h: number | null;
}

export interface SucursalConPosicion {
  posicion: PosicionPortal | null;
}

/**
 * Pasa el `posX/posY/posW/posH` de la base (cada uno puede faltar) a una posición, o `null` si no está completa: x, y y w
 * tienen que estar los tres, y ser números finitos; h es opcional.
 */
export function posicionCompleta(x: number | null, y: number | null, w: number | null, h: number | null): PosicionPortal | null {
  const finito = (n: number | null): n is number => n !== null && Number.isFinite(n);
  if (!finito(x) || !finito(y) || !finito(w)) return null;
  return { x, y, w, h: finito(h) ? h : null };
}

export interface LayoutPortal<T extends SucursalConPosicion> {
  modo: "mapa" | "grilla";
  /** Las que se dibujan sobre el mapa (vacío en modo grilla). */
  enMapa: readonly T[];
  /** Las que van en la grilla: en modo grilla, todas; en modo mapa, las que no tienen posición completa. */
  enGrilla: readonly T[];
}

/**
 * Mapa si hay imagen de fondo Y al menos una sucursal con posición completa; si no, grilla. En modo mapa las que no tienen
 * posición no desaparecen: van en la grilla de abajo.
 */
export function decidirLayoutPortal<T extends SucursalConPosicion>(sucursales: readonly T[], imagenFondo: string | null): LayoutPortal<T> {
  const conPosicion = sucursales.filter((s) => s.posicion !== null);
  if (imagenFondo && conPosicion.length > 0) {
    return { modo: "mapa", enMapa: conPosicion, enGrilla: sucursales.filter((s) => s.posicion === null) };
  }
  return { modo: "grilla", enMapa: [], enGrilla: sucursales };
}

/** Qué le falta al portal para verse como mapa cuando ya hay imagen cargada; `null` si no hay imagen o ya se ve como mapa. */
export function avisoImagenSinMapa(hayImagen: boolean, modo: LayoutPortal<SucursalConPosicion>["modo"], totalSucursales: number): string | null {
  if (!hayImagen || modo === "mapa") return null;
  if (totalSucursales === 0) return "La imagen está cargada, pero ninguna sucursal está publicada en el portal: sin sucursales publicadas no se ve el mapa.";
  return "La imagen está cargada, pero ninguna sucursal tiene posición en el mapa, por eso el portal se ve como lista. Cargá x, y y ancho en «Posición en el mapa del portal» de cada sucursal (más abajo).";
}
