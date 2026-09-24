import { texto, validarLargoTexto, validarTextoCatalogo } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { urlImagenSegura } from "./armar-menu";

/**
 * Validaciones de lo que se carga desde el admin de la carta (docs/plan-carta-catalogo-2026-09-24.md, M9). Puras, sin Prisma:
 * las usan las Server Actions de `src/server/actions/carta/` antes de escribir. Todo lo que pasa por acá termina en la carta
 * PÚBLICA, así que se valida en la entrada y no solo al servirlo (el endpoint igual vuelve a filtrar las imágenes).
 */

export const LARGO_MAXIMO_DESCRIPCION_CARTA = 500;
export const LARGO_MAXIMO_TITULO_CARTA = 120;
export const MAXIMO_TAGS_CARTA = 8;
export const LARGO_MAXIMO_TAG_CARTA = 30;
/** Letras, números, espacio y poca puntuación: los tags se muestran como chips y filtros en la carta. */
const RE_TAG = /^[\p{L}\p{N} \-.&/+'!]+$/u;

type Resultado<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

/** Vacío → null (sin imagen). Si hay algo, tiene que ser `https://` sin espacios, comillas ni paréntesis. */
export function validarImagenUrlCarta(valor: unknown, etiqueta = "La URL de la imagen"): Resultado<string | null> {
  const v = texto(valor);
  if (!v) return { ok: true, valor: null };
  if (v.length > 1000) return { ok: false, mensaje: `${etiqueta} es demasiado larga.` };
  const segura = urlImagenSegura(v);
  if (!segura) return { ok: false, mensaje: `${etiqueta} tiene que empezar con https:// y no puede tener espacios, comillas ni paréntesis.` };
  return { ok: true, valor: segura };
}

/**
 * Acepta una lista o un texto separado por comas (como la columna de la sheet de hoy). Recorta, descarta vacíos y repetidos
 * (sin distinguir mayúsculas), y valida cantidad, largo y caracteres.
 */
export function normalizarTagsCarta(valor: readonly string[] | string | null | undefined): Resultado<string[]> {
  const crudos = Array.isArray(valor) ? valor : String(valor ?? "").split(",");
  const tags: string[] = [];
  const vistos = new Set<string>();
  for (const crudo of crudos) {
    const t = texto(crudo);
    if (!t) continue;
    if (t.length > LARGO_MAXIMO_TAG_CARTA) return { ok: false, mensaje: `El tag "${t.slice(0, 20)}…" supera los ${LARGO_MAXIMO_TAG_CARTA} caracteres.` };
    if (!RE_TAG.test(t)) return { ok: false, mensaje: `El tag "${t}" tiene caracteres no permitidos.` };
    const clave = t.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    tags.push(t);
  }
  if (tags.length > MAXIMO_TAGS_CARTA) return { ok: false, mensaje: `Como máximo ${MAXIMO_TAGS_CARTA} tags por producto.` };
  return { ok: true, valor: tags };
}

/** Texto libre opcional (descripción, título): vacío → null; si no, recortado y con largo máximo. */
export function validarTextoLibreCarta(valor: unknown, etiqueta: string, maximo: number): Resultado<string | null> {
  const v = texto(valor);
  if (!v) return { ok: true, valor: null };
  const errorLargo = validarLargoTexto(v, etiqueta, maximo);
  if (errorLargo) return { ok: false, mensaje: errorLargo };
  return { ok: true, valor: v };
}

/** Nombre obligatorio de una sección de carta: mismo charset y largo que el resto de los nombres del catálogo. */
export function validarNombreSeccionCarta(valor: unknown): Resultado<string> {
  const v = texto(valor);
  if (!v) return { ok: false, mensaje: "El nombre de la sección de carta no puede estar vacío." };
  const invalido = validarTextoCatalogo(v, "El nombre de la sección de carta");
  if (invalido) return { ok: false, mensaje: invalido };
  return { ok: true, valor: v };
}

/** Orden: entero (puede ser negativo, para subir algo sin renumerar), vacío → 0. */
export function validarOrdenCarta(valor: unknown): Resultado<number> {
  if (valor === null || valor === undefined || texto(valor) === "") return { ok: true, valor: 0 };
  const n = Number(valor);
  if (!Number.isInteger(n) || Math.abs(n) > 100_000) return { ok: false, mensaje: "El orden tiene que ser un número entero." };
  return { ok: true, valor: n };
}

/** Precio de una promo: número finito, >= 0, con a lo sumo 2 decimales (se guarda como Decimal(14, 2)). */
export function validarPrecioCarta(valor: unknown): Resultado<number> {
  if (valor === null || valor === undefined || texto(valor) === "") return { ok: false, mensaje: "Falta el precio." };
  const n = Number(valor);
  if (!(n >= 0)) return { ok: false, mensaje: "El precio no puede ser negativo." };
  if (!esNumeroFinito(n) || n >= 1e12) return { ok: false, mensaje: "El precio no es un número válido." };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M2): lo que se carga en `SucursalPublica`. También
// los usa `armarRegistroTenants` para sanear la salida del endpoint (una fila cargada a mano por `db:studio` no pasa por acá).
// ---------------------------------------------------------------------------------------------------------------------------

export const LARGO_MAXIMO_SLUG_TENANT = 60;
export const LARGO_MAXIMO_ETIQUETA_PORTAL = 80;
export const LARGO_MAXIMO_SUBTITULO_PORTAL = 200;
export const LARGO_MAXIMO_TAB_SHEET = 100;
export const TAB_MENU_POR_DEFECTO = "Menu";
/** Minúsculas, dígitos y guiones sueltos entre medio: es el `/carta/<slug>` público (y el `tenant_id` de la sheet). */
const RE_SLUG_TENANT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Id de un Google Spreadsheet (lo que va entre `/d/` y la barra siguiente en su URL). */
const RE_SHEET_ID = /^[A-Za-z0-9_-]{20,128}$/;
const RE_URL_SHEET = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/;
const RE_ETIQUETA_DNS = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const RE_CONTROL = /[\u0000-\u001f\u007f]/;

/** Slug del portal: se recorta y se pasa a minúsculas; después tiene que cumplir el formato y el largo. */
export function validarSlugTenant(valor: unknown): Resultado<string> {
  const v = texto(valor).toLowerCase();
  if (!v) return { ok: false, mensaje: "El slug no puede estar vacío." };
  if (v.length > LARGO_MAXIMO_SLUG_TENANT) return { ok: false, mensaje: `El slug no puede superar los ${LARGO_MAXIMO_SLUG_TENANT} caracteres.` };
  if (!RE_SLUG_TENANT.test(v)) return { ok: false, mensaje: "El slug solo puede tener letras minúsculas sin tilde, números y guiones sueltos entre medio (ej: villa-la-angostura)." };
  return { ok: true, valor: v };
}

/**
 * Dominio propio del tenant (hecho externo, manual): vacío → null. Se normaliza a host desnudo — sin `http(s)://`, sin barra
 * final, sin puerto, en minúsculas — y se valida como nombre de host con al menos un punto. Una ruta (`/algo`) no se acepta.
 */
export function validarDominioPublico(valor: unknown): Resultado<string | null> {
  let v = texto(valor).toLowerCase();
  if (!v) return { ok: true, valor: null };
  v = v.replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/:\d+$/, "");
  const mensaje = `El dominio "${texto(valor).slice(0, 60)}" no es válido: tiene que ser un nombre de host como carta.mirestaurante.com.`;
  if (!v || v.length > 253 || v.includes("/")) return { ok: false, mensaje };
  const etiquetas = v.split(".");
  if (etiquetas.length < 2 || !etiquetas.every((e) => RE_ETIQUETA_DNS.test(e)) || /^\d+$/.test(etiquetas[etiquetas.length - 1])) return { ok: false, mensaje };
  return { ok: true, valor: v };
}

/** Id del spreadsheet del tenant: vacío → null. Acepta también la URL completa de la sheet y se queda con el id. */
export function validarSheetId(valor: unknown): Resultado<string | null> {
  let v = texto(valor);
  if (!v) return { ok: true, valor: null };
  const deUrl = RE_URL_SHEET.exec(v);
  if (deUrl) v = deUrl[1];
  if (!RE_SHEET_ID.test(v)) return { ok: false, mensaje: "El id de la sheet no es válido: es el texto que va entre /d/ y la barra siguiente en la URL de la sheet (o pegá la URL completa)." };
  return { ok: true, valor: v };
}

/** Nombre de la tab del menú en la sheet del tenant: vacío → "Menu"; si no, hasta 100 caracteres sin caracteres de control. */
export function validarNombreTabSheet(valor: unknown): Resultado<string> {
  const v = texto(valor);
  if (!v) return { ok: true, valor: TAB_MENU_POR_DEFECTO };
  if (v.length > LARGO_MAXIMO_TAB_SHEET) return { ok: false, mensaje: `El nombre de la tab no puede superar los ${LARGO_MAXIMO_TAB_SHEET} caracteres.` };
  if (RE_CONTROL.test(v)) return { ok: false, mensaje: "El nombre de la tab tiene caracteres no permitidos." };
  return { ok: true, valor: v };
}

export interface PosicionPortal {
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

/**
 * Posición de la sucursal sobre el mapa del portal, en % (0-100) del centro, redondeada a 2 decimales (se guarda como
 * Decimal(5, 2)). `x`, `y` y el ancho van juntos (los tres o ninguno); el alto es opcional, pero solo con los otros tres.
 */
export function validarPosicionPortal(valor: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }): Resultado<PosicionPortal> {
  const nombres = { x: "La posición x", y: "La posición y", w: "El ancho", h: "El alto" } as const;
  const pos: PosicionPortal = { x: null, y: null, w: null, h: null };
  for (const clave of ["x", "y", "w", "h"] as const) {
    const crudo = valor[clave];
    if (crudo === null || crudo === undefined || texto(crudo) === "") continue;
    const n = Number(typeof crudo === "string" ? crudo.trim().replace(",", ".") : crudo);
    if (!esNumeroFinito(n) || typeof crudo === "boolean") return { ok: false, mensaje: `${nombres[clave]} no es un número válido.` };
    if (n < 0 || n > 100) return { ok: false, mensaje: `${nombres[clave]} tiene que estar entre 0 y 100 (es un porcentaje del mapa).` };
    pos[clave] = Math.round(n * 100) / 100;
  }
  const cargados = [pos.x, pos.y, pos.w].filter((v) => v !== null).length;
  if (cargados !== 0 && cargados !== 3) return { ok: false, mensaje: "La posición en el mapa necesita x, y y ancho juntos (o ninguno de los tres)." };
  if (cargados === 0 && pos.h !== null) return { ok: false, mensaje: "El alto solo se puede cargar junto con x, y y ancho." };
  return { ok: true, valor: pos };
}
