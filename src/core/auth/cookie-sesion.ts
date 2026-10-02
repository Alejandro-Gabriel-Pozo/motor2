/**
 * Nombre y atributos de la cookie de sesión de Auth.js (informe de seguridad 2026-10-01, S-04, y decisión del dueño sobre las cartas).
 *
 * En producción con https la cookie es `__Host-authjs.session-token`: el prefijo `__Host-` obliga al navegador a aceptarla solo con
 * `Secure`, `Path=/` y SIN `Domain`, así que un subdominio hermano (p. ej. el de una carta) no puede pisarla ni plantar una propia
 * ("cookie tossing"). Sin https (desarrollo y la suite e2e corren por http) no se puede usar `__Host-` y queda el nombre por defecto.
 */

export const COOKIE_SESION_HTTP = "authjs.session-token";
export const COOKIE_SESION_HOST = "__Host-authjs.session-token";
/** El nombre que Auth.js usaba antes con https: una sesión vieja con esta cookie ya no es válida (se reinicia sesión una vez). */
const COOKIE_SESION_SECURE_ANTERIOR = "__Secure-authjs.session-token";

interface EntornoCookie {
  NODE_ENV?: string;
  VERCEL?: string;
  AUTH_URL?: string;
}

/** `true` cuando la aplicación se sirve por https: Vercel, o `AUTH_URL` con https, y siempre en modo producción. */
export function sirvePorHttps(env: EntornoCookie): boolean {
  if (env.NODE_ENV !== "production") return false;
  return env.VERCEL === "1" || /^https:\/\//i.test(env.AUTH_URL ?? "");
}

export function nombreCookieSesion(env: EntornoCookie): string {
  return sirvePorHttps(env) ? COOKIE_SESION_HOST : COOKIE_SESION_HTTP;
}

/** Todos los nombres con los que puede llegar la cookie de sesión (el proxy solo pregunta si hay alguna). */
export const NOMBRES_COOKIE_SESION = [COOKIE_SESION_HTTP, COOKIE_SESION_SECURE_ANTERIOR, COOKIE_SESION_HOST] as const;
