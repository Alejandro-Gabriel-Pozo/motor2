/**
 * Cabeceras de seguridad HTTP (informe de seguridad 2026-10-01, S-04). PURO: arma textos, no lee `process.env` ni toca Next.
 *
 * Dos políticas de Content-Security-Policy:
 *  - la APP (admin, POS, login): con nonce por pedido, generado en `src/proxy.ts`. Sin `'unsafe-inline'` ni `'unsafe-eval'` en
 *    `script-src` (en desarrollo, Next necesita `'unsafe-eval'`). Un nonce obliga a renderizar cada pedido (no hay caché estática),
 *    lo que en la app ya es así: cada pantalla depende de la sesión.
 *  - la CARTA pública: estática (sin nonce) para poder seguir siendo ISR. Necesita `'unsafe-inline'` en `script-src` por los scripts
 *    en línea con que Next arranca la hidratación; se compensa con que la carta no tiene sesión, no acepta entrada ni renderiza
 *    HTML ajeno, y con `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` y `frame-ancestors 'none'`.
 */

/** Orígenes de ingesta de Sentry (el SDK del navegador manda ahí los errores y las trazas). */
const SENTRY_INGESTA = ["https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io"];

export interface OpcionesCspApp {
  nonce: string;
  /** Desarrollo: Next usa `eval` para el refresco en caliente y estilos en línea sin nonce. */
  desarrollo: boolean;
  /** Pedidos servidos por https (producción): suma `upgrade-insecure-requests`. */
  https: boolean;
  /** Orígenes ajenos a los que un formulario puede enviar o redirigir además del propio. Por defecto Google (el login de la app); la consola de plataforma no tiene ninguno. */
  destinosDeFormulario?: readonly string[];
}

function unir(directivas: (string | null)[]): string {
  return directivas.filter((d): d is string => !!d).join("; ");
}

export function cspApp({ nonce, desarrollo, https, destinosDeFormulario = ["https://accounts.google.com"] }: OpcionesCspApp): string {
  return unir([
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desarrollo ? " 'unsafe-eval'" : ""}`,
    // Las hojas y los <style> de Next llevan nonce; los atributos `style=""` (React los emite como estilo en línea) no se pueden
    // firmar con nonce, por eso `style-src-attr` es la única concesión: un atributo de estilo no ejecuta código.
    desarrollo ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${SENTRY_INGESTA.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    // El login redirige a Google (Chrome aplica `form-action` también a las redirecciones del envío).
    ["form-action 'self'", ...destinosDeFormulario].join(" "),
    "frame-ancestors 'none'",
    https ? "upgrade-insecure-requests" : null,
  ]);
}

export function cspCarta({ https }: { https: boolean }): string {
  return unir([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // Las imágenes de la carta las carga cada comercio con una URL https propia: no se puede acotar el origen.
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${SENTRY_INGESTA.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    https ? "upgrade-insecure-requests" : null,
  ]);
}

export interface Cabecera {
  key: string;
  value: string;
}

/** Cabeceras que van en TODAS las respuestas (app y carta). Las ignora el navegador donde no corresponden (HSTS sobre http). */
export function cabecerasComunes(): Cabecera[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

/** Cabeceras propias de la carta pública: su CSP estática y, por defecto, que no la indexen los buscadores (decisión pendiente del dueño). */
export function cabecerasCarta({ https }: { https: boolean }): Cabecera[] {
  return [
    { key: "Content-Security-Policy", value: cspCarta({ https }) },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ];
}

/** Nonce criptográficamente aleatorio y distinto en cada pedido (base64 de 16 bytes). */
export function generarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
