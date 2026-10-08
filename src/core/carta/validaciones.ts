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
const MAXIMO_TAGS_CARTA = 8;
const LARGO_MAXIMO_TAG_CARTA = 30;
/** Letras, números, espacio y poca puntuación: los tags se muestran como chips y filtros en la carta. */
const RE_TAG = /^[\p{L}\p{N} \-.&/+'!]+$/u;

/** Resultado de un validador de la carta: el valor normalizado o el mensaje listo para mostrar (lo usan también css-valores.ts y tema.ts). */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

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
 * Acepta una lista o un texto separado por comas (como en un campo de tags). Recorta, descarta vacíos y repetidos
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

/** Nombre obligatorio de un ítem agrupado de la carta ("Gaseosa 500 CC"; docs/plan-agrupacion-items-carta-2026-09-24.md, M5). */
export function validarNombreItemAgrupadoCarta(valor: unknown): Resultado<string> {
  const v = texto(valor);
  if (!v) return { ok: false, mensaje: "El nombre del ítem agrupado no puede estar vacío." };
  const invalido = validarTextoCatalogo(v, "El nombre del ítem agrupado");
  if (invalido) return { ok: false, mensaje: invalido };
  return { ok: true, valor: v };
}

/** Nombre obligatorio de un género de carta ("Cerveza"; docs/plan-genero-carta-2026-09-26.md). Mismo charset que el resto. */
export function validarNombreGeneroCarta(valor: unknown): Resultado<string> {
  const v = texto(valor);
  if (!v) return { ok: false, mensaje: "El nombre del género no puede estar vacío." };
  const invalido = validarTextoCatalogo(v, "El nombre del género");
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

/**
 * Precio de una promo: número finito, >= 0, con a lo sumo 2 decimales (se guarda como Decimal(14, 2)).
 *
 * O.43 (Hito 4, bloque D; aprobado por el dueño, criterio conservador): `Number(...)` NO acepta la coma decimal y eso NO cambia (el parseo es el de siempre); lo
 * que cambió es el mensaje de lo que no tiene forma de número («12,5», «abc»): antes caía en `!(n >= 0)` y decía «no puede ser negativo».
 */
export function validarPrecioCarta(valor: unknown): Resultado<number> {
  if (valor === null || valor === undefined || texto(valor) === "") return { ok: false, mensaje: "Falta el precio." };
  const n = Number(valor);
  if (Number.isNaN(n)) return { ok: false, mensaje: "El precio no tiene un formato válido: usá el punto como separador decimal (por ejemplo, 12.5)." };
  if (!(n >= 0)) return { ok: false, mensaje: "El precio no puede ser negativo." };
  if (!esNumeroFinito(n) || n >= 1e12) return { ok: false, mensaje: "El precio no es un número válido." };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

/**
 * Cantidad de un cupo de promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): entero entre 0 y 999 (mismo tope
 * que `CANTIDAD_MAXIMA_POR_ITEM` del POS). `valorSiVacio` (D1: el mínimo por defecto es 0) — sin pasarlo, un valor vacío es un
 * error, para exigir la cantidad máxima siempre explícita.
 */
export function validarCantidadCupoPromo(valor: unknown, etiqueta: string, valorSiVacio?: number): Resultado<number> {
  const v = texto(valor);
  if (v === "") {
    if (valorSiVacio !== undefined) return { ok: true, valor: valorSiVacio };
    return { ok: false, mensaje: `Falta ${etiqueta}.` };
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 999) return { ok: false, mensaje: `${etiqueta} tiene que ser un número entero entre 0 y 999.` };
  return { ok: true, valor: n };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M2): lo que se carga en `SucursalPublica`.
// ---------------------------------------------------------------------------------------------------------------------------

export const LARGO_MAXIMO_SLUG_TENANT = 60;
export const LARGO_MAXIMO_ETIQUETA_PORTAL = 80;
export const LARGO_MAXIMO_SUBTITULO_PORTAL = 200;
/** Minúsculas, dígitos y guiones sueltos entre medio: es el `/carta/<slug>` público. */
const RE_SLUG_TENANT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slug del portal: se recorta y se pasa a minúsculas; después tiene que cumplir el formato y el largo. */
export function validarSlugTenant(valor: unknown): Resultado<string> {
  const v = texto(valor).toLowerCase();
  if (!v) return { ok: false, mensaje: "El slug no puede estar vacío." };
  if (v.length > LARGO_MAXIMO_SLUG_TENANT) return { ok: false, mensaje: `El slug no puede superar los ${LARGO_MAXIMO_SLUG_TENANT} caracteres.` };
  if (!RE_SLUG_TENANT.test(v)) return { ok: false, mensaje: "El slug solo puede tener letras minúsculas sin tilde, números y guiones sueltos entre medio (ej: villa-la-angostura)." };
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
