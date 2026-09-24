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
