/**
 * «Volver a donde estaba» después de iniciar sesión. Cuando la sesión vence con la pestaña abierta, se manda a la persona a
 * `/login?volver=<ruta>` y, al entrar con Google, se la devuelve a esa ruta. Como `volver` viene de la URL (o del encabezado
 * Referer), es entrada del usuario: SOLO se acepta una ruta interna de la propia aplicación. Cualquier otra cosa (otro sitio,
 * `//sitio`, `/\sitio`, `javascript:`, caracteres de control) se descarta, y de lo contrario sería una redirección abierta
 * (alguien manda un enlace `…/login?volver=https://sitio-falso` y, tras el login de verdad, se lo lleva a un sitio ajeno). Las rutas
 * legítimas nunca traen caracteres fuera de ASCII: el `Referer` y `urlDeLogin` ya vienen con todo codificado en %XX.
 */

const LARGO_MAXIMO = 500;

/** Encabezado con el que `src/proxy.ts` le dice a la aplicación qué ruta (con su consulta) se pidió. Ver `irAlLogin`. */
export const ENCABEZADO_RUTA_PEDIDA = "x-motor2-ruta-pedida";

/** La ruta (con su consulta) si es una ruta interna segura para volver a ella; si no, `null`. */
export function rutaInternaSegura(valor: string | null | undefined): string | null {
  if (!valor || valor.length > LARGO_MAXIMO) return null;
  // Tiene que ser una ruta absoluta de este sitio: empieza con una sola «/» (no «//sitio» ni «/\sitio», que el navegador lee como otro host).
  if (!valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) return null;
  // Solo ASCII imprimible (sin espacios ni caracteres de control) y sin barras invertidas, en ninguna parte. Un carácter fuera de
  // ASCII no saca del sitio, pero un `Location` con un code point mayor a 255 hace lanzar a Node y `/login` respondía 500.
  if (/[^\x21-\x7e]|\\/.test(valor)) return null;

  // Debe seguir siendo una ruta del mismo origen una vez interpretada.
  let url: URL;
  try {
    url = new URL(valor, "http://interno.local");
  } catch {
    return null;
  }
  if (url.origin !== "http://interno.local") return null;

  // Volver a la raíz no aporta (la raíz decide sola a dónde ir), a /login sería un bucle y /api/* no son pantallas.
  const ruta = url.pathname;
  if (ruta === "/" || ruta === "/login" || ruta.startsWith("/login/") || ruta.startsWith("/api/")) return null;

  return valor;
}

/** La ruta interna a la que apunta un encabezado `Referer`, solo si es de ESTE sitio (mismo host); si no, `null`. */
export function rutaDesdeReferer(referer: string | null | undefined, host: string | null | undefined): string | null {
  if (!referer || !host) return null;
  try {
    const url = new URL(referer);
    if (url.host !== host) return null;
    return rutaInternaSegura(url.pathname + url.search);
  } catch {
    return null;
  }
}

/** `/login`, con `?volver=` si hay adónde volver. */
export function urlDeLogin(volver: string | null): string {
  return volver ? `/login?volver=${encodeURIComponent(volver)}` : "/login";
}
