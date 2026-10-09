/**
 * Nombre y atributos de la cookie de sesión de Auth.js (informe de seguridad 2026-10-01, S-04, y decisión del dueño sobre las cartas).
 *
 * En producción con https la cookie es `__Host-authjs.session-token`: el prefijo `__Host-` obliga al navegador a aceptarla solo con
 * `Secure`, `Path=/` y SIN `Domain`, así que un subdominio hermano (p. ej. el de una carta) no puede pisarla ni plantar una propia
 * ("cookie tossing"). Sin https (desarrollo y la suite e2e corren por http) no se puede usar `__Host-` y queda el nombre por defecto.
 */

export const COOKIE_SESION_HTTP = "authjs.session-token";
export const COOKIE_SESION_HOST = "__Host-authjs.session-token";
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

/**
 * El token de la sesión abierta: el de la ÚNICA cookie que Auth.js lee en este entorno (`nombreCookieSesion(env)`, la misma que `lib/auth.ts` le configura), nunca «la primera que aparezca».
 * Con https es SOLO `__Host-authjs.session-token`: una cookie sin prefijo o `__Secure-` (la de versiones anteriores) la puede plantar un subdominio hermano para el dominio padre
 * (S-20, T8 del endurecimiento), y si esta función la tomara antes que la `__Host-` real, el chequeo de «sesión abierta de otro email» (la vinculación de una cuenta de Google ajena a
 * una sesión abierta) miraría la sesión equivocada y quedaría sin freno. Una sesión vieja con el nombre anterior ya no es válida (se reinicia sesión una vez).
 * Es la ÚNICA lectura del nombre: un chequeo que mire otro no ve la sesión en producción.
 */
export function tokenDeSesionAbierta(leer: (nombre: string) => string | undefined, env: EntornoCookie): string | undefined {
  return leer(nombreCookieSesion(env)) || undefined;
}
