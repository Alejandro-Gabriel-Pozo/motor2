import type { Resultado } from "./validaciones";

/**
 * Validadores de los valores de tipografía, layout y contacto del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M2, D13).
 * Puros, sin Prisma: los usa `tema.ts` (catálogo de claves) en la entrada (Server Actions, "Pegar desde la sheet") y en la salida
 * (el endpoint vuelve a validar el Json guardado, porque una carga por `db:studio` no pasa por las acciones).
 *
 * Todo lo que es CSS termina en la carta pública dentro de un `style` de React o, en el caso del alto de banda en desktop,
 * crudo dentro de un `<style>` (carta-view.tsx de restaurant-menu-design). Por eso hay dos barreras:
 *  1. `valorCssSeguro`: un filtro de caracteres sobre el valor recortado y en minúsculas, `^[0-9a-z.%+\-(), ]{1,80}$`. Deja afuera
 *     `; { } < > " ' \ / * : ! @ # =`, los saltos de línea y todo lo que no sea ASCII: con eso no hay forma de cerrar una regla
 *     ni un `<style>`. NO SE DEBILITA por conveniencia: es la defensa contra la inyección.
 *  2. `parsearLongitudCss`: una gramática chica (no una regex única) que asegura que además sea CSS correcto:
 *       numero   = \d+(\.\d+)? | \.\d+           (sin signo, hasta 10000)
 *       unidad   ∈ px rem em % vw vh svh dvh lvh vmin vmax
 *       longitud = numero unidad | 0
 *       suma     = longitud ( ␠[+-]␠ longitud )*  (espacios obligatorios alrededor de + y -, como exige CSS)
 *       funcion  = clamp(suma, suma, suma) | min(suma, suma[, suma…]) | max(…) (hasta 4 argumentos) | calc(suma)
 *     Sin funciones anidadas (ningún default de la carta las necesita).
 *
 * Los valores CSS se guardan recortados y en minúsculas (CSS no distingue mayúsculas en unidades ni funciones).
 */

const LARGO_MAXIMO_CSS = 80;
const RE_CARACTERES_CSS = /^[0-9a-z.%+\-(), ]{1,80}$/;
const NUMERO_MAXIMO = 10000;
const RE_LONGITUD = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em|%|vw|vh|svh|dvh|lvh|vmin|vmax)?$/;
/** Un número "solo", como lo reconoce `normFuente` de la carta (lib/format-utils.ts): sin signo, sin exponente, sin ".5". */
const RE_NUMERO_SOLO = /^\d+(\.\d+)?$/;
const RE_FUNCION = /^(clamp|min|max|calc)\((.*)\)$/;
const ARGUMENTOS: Record<string, { min: number; max: number }> = {
  clamp: { min: 3, max: 3 },
  min: { min: 2, max: 4 },
  max: { min: 2, max: 4 },
  calc: { min: 1, max: 1 },
};

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const mal = <T>(mensaje: string): Resultado<T> => ({ ok: false, mensaje });

/**
 * El filtro de caracteres (barrera 1): recorta, pasa a minúsculas y exige `^[0-9a-z.%+\-(), ]{1,80}$`. Devuelve el valor
 * normalizado o `null` si no pasa.
 */
export function valorCssSeguro(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim().toLowerCase();
  if (s.length > LARGO_MAXIMO_CSS || !RE_CARACTERES_CSS.test(s)) return null;
  return s;
}

/** `longitud` de la gramática: número con unidad, o `0` a secas. */
function esLongitud(token: string): boolean {
  const m = RE_LONGITUD.exec(token);
  if (!m) return false;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n > NUMERO_MAXIMO) return false;
  return m[2] !== undefined || n === 0;
}

/** `suma` de la gramática: longitudes separadas por ` + ` o ` - ` (con espacios). */
function esSuma(argumento: string): boolean {
  const a = argumento.trim();
  if (!a) return false;
  return a.split(/ +[+-] +/).every(esLongitud);
}

function esFuncion(s: string): boolean {
  const m = RE_FUNCION.exec(s);
  if (!m) return false;
  const interior = m[2];
  // Sin funciones anidadas: dentro de los paréntesis no puede haber otro paréntesis.
  if (/[()]/.test(interior)) return false;
  const argumentos = interior.split(",");
  const { min, max } = ARGUMENTOS[m[1]];
  if (argumentos.length < min || argumentos.length > max) return false;
  return argumentos.every(esSuma);
}

/**
 * Una longitud CSS de la gramática de arriba (barrera 2, después del filtro de caracteres). Con `funciones: false` solo acepta
 * `longitud` (número con unidad, o 0). Devuelve el valor normalizado (recortado, en minúsculas).
 */
export function parsearLongitudCss(v: unknown, opciones: { funciones: boolean }): Resultado<string> {
  const s = valorCssSeguro(v);
  if (s === null) return mal("tiene caracteres no permitidos o es demasiado largo (hasta 80: números, letras, espacios y . % + - ( ) ,)");
  if (esLongitud(s)) return ok(s);
  if (opciones.funciones && esFuncion(s)) return ok(s);
  return mal(
    opciones.funciones
      ? "no es una medida válida: usá un número con unidad (px, rem, em, %, vw, vh…) o clamp(), min(), max() o calc() sin anidar"
      : "no es una medida válida: usá un número con unidad (px, rem, em, %, vw, vh…)"
  );
}

/** Un número solo dentro de [min, max] (con el formato de `normFuente`), o `null` si no es un número solo. */
function numeroSolo(s: string, min: number, max: number): Resultado<number> | null {
  if (!RE_NUMERO_SOLO.test(s)) return null;
  const n = Number(s);
  if (n < min || n > max) return mal(`como número solo tiene que estar entre ${min} y ${max}`);
  return ok(n);
}

/** Tamaño de fuente (los 17 `carta_fuente_*` y `topbar_back_size`): número solo entre 4 y 200 (la carta lo pasa a px), longitud o función. */
export function validarTamanoFuente(v: unknown): Resultado<string> {
  const s = valorCssSeguro(v);
  if (s !== null) {
    const n = numeroSolo(s, 4, 200);
    if (n) return n.ok ? ok(s) : mal(n.mensaje);
  }
  return parsearLongitudCss(v, { funciones: true });
}

/**
 * Alto de la banda de sección: número solo entre 20 y 600 (px), longitud o función. Con `normalizarPx` (el de desktop, que la
 * carta inyecta crudo dentro de un `<style>`: un "120" sin unidad sería CSS inválido) el número solo se guarda como "120px".
 */
export function validarAltoBanda(v: unknown, opciones: { normalizarPx: boolean }): Resultado<string> {
  const s = valorCssSeguro(v);
  if (s !== null) {
    const n = numeroSolo(s, 20, 600);
    if (n) return n.ok ? ok(opciones.normalizarPx ? `${s}px` : s) : mal(n.mensaje);
  }
  return parsearLongitudCss(v, { funciones: true });
}

/** Porcentaje de posición (bloque y CTA de la portada): número entre 0 y 100, hasta 2 decimales, sin `%` (la carta se lo agrega). */
export function validarPorcentaje(v: unknown): Resultado<string> {
  const s = valorCssSeguro(v);
  if (s === null || !/^\d+(\.\d{1,2})?$/.test(s)) return mal("tiene que ser un número entre 0 y 100, con hasta 2 decimales y sin %");
  const n = Number(s);
  if (n > 100) return mal("tiene que ser un número entre 0 y 100, con hasta 2 decimales y sin %");
  return ok(String(n));
}

/** Opacidad de la imagen de sección: entero entre 1 y 100 (la carta convierte el 0 en 38, por eso no se acepta). */
export function validarOpacidad(v: unknown): Resultado<string> {
  const s = valorCssSeguro(v);
  if (s === null || !/^\d+$/.test(s)) return mal("tiene que ser un número entero entre 1 y 100");
  const n = Number(s);
  if (n < 1 || n > 100) return mal("tiene que ser un número entero entre 1 y 100");
  return ok(String(n));
}

/** Uno de `opciones`, sin distinguir mayúsculas; `alias` mapea otras escrituras (ya en minúsculas) a la canónica. */
export function validarEnum(v: unknown, opciones: readonly string[], alias: Readonly<Record<string, string>> = {}): Resultado<string> {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (opciones.includes(s)) return ok(s);
  if (Object.hasOwn(alias, s)) return ok(alias[s]);
  return mal(`tiene que ser uno de: ${opciones.join(", ")}`);
}

const HOSTS_RED: Record<"instagram" | "facebook", readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"],
};
const RE_USUARIO_RED: Record<"instagram" | "facebook", RegExp> = {
  instagram: /^@?([A-Za-z0-9._]{1,30})$/,
  facebook: /^([A-Za-z0-9.-]{1,50})$/,
};

/** URL `https://` bien formada, sin espacios, comillas ni `<>\``, hasta `maximo` caracteres; devuelve la URL parseada o null. */
function urlHttpsSegura(v: string, maximo: number): URL | null {
  if (v.length > maximo || !/^https:\/\/[^\s"'<>`\\]+$/i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname ? u : null;
  } catch {
    return null;
  }
}

/**
 * Instagram o Facebook: un usuario (Instagram `@?[A-Za-z0-9._]{1,30}`, se guarda sin `@`; Facebook `[A-Za-z0-9.\-]{1,50}`) o una
 * URL `https://` a uno de los hosts de esa red. La carta arma el link con el usuario, o usa la URL tal cual si empieza con http.
 */
export function validarRedSocial(v: unknown, red: "instagram" | "facebook"): Resultado<string> {
  const s = typeof v === "string" ? v.trim() : "";
  const usuario = RE_USUARIO_RED[red].exec(s);
  if (usuario) return ok(usuario[1]);
  const nombre = red === "instagram" ? "Instagram" : "Facebook";
  if (/^https?:/i.test(s)) {
    const u = urlHttpsSegura(s, 500);
    if (!u) return mal(`tiene que ser una URL https:// de ${nombre}`);
    if (!HOSTS_RED[red].includes(u.hostname.toLowerCase())) return mal(`la URL tiene que ser de ${HOSTS_RED[red].join(", ")}`);
    return ok(s);
  }
  return mal(`tiene que ser un usuario de ${nombre} o una URL https:// de ${nombre}`);
}

/** WhatsApp: entre 8 y 15 dígitos después de quitar espacios, `+`, `-`, `(` y `)`. Se guardan solo los dígitos. */
export function validarTelefono(v: unknown): Resultado<string> {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim().replace(/[\s+\-()]/g, "") : "";
  if (!/^\d{8,15}$/.test(s)) return mal("tiene que ser un teléfono de 8 a 15 dígitos (se admiten espacios, +, - y paréntesis)");
  return ok(s);
}

/** Link (Google Maps): URL `https://` bien formada, sin espacios ni comillas, hasta 500 caracteres. */
export function validarUrlHttps(v: unknown): Resultado<string> {
  const s = typeof v === "string" ? v.trim() : "";
  if (!urlHttpsSegura(s, 500)) return mal("tiene que ser una URL https:// sin espacios ni comillas (hasta 500 caracteres)");
  return ok(s);
}
