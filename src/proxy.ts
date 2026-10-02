import { NextResponse, type NextRequest } from "next/server";
import { ENCABEZADO_RUTA_PEDIDA } from "@/core/navegacion/volver";
import { esHostDeZonaCarta, esMetodoDeLecturaEnHostCarta, esPathPermitidoEnHostCarta, interpretarHostCarta } from "@/core/carta/host";
import { NOMBRES_COOKIE_SESION, sirvePorHttps } from "@/core/auth/cookie-sesion";
import { cabecerasComunes, cspApp, generarNonce } from "@/core/seguridad/cabeceras";

/**
 * Puerta de entrada de todos los pedidos que no son archivos de Next (el `matcher` excluye `_next/static`, `_next/image` y el favicon).
 * Hace tres cosas, en este orden:
 *
 * 1. Host de la carta (`<empresa>.<CARTA_DOMINIO_BASE>`): ahí solo se sirve la carta pública (la raíz y `/<sucursal>`, solo con GET/HEAD y
 *    sin `next-action`); cualquier otro path (login, API, cron, la aplicación) es 404 sin llegar a la app. Un host de la zona de cartas que no es una carta válida
 *    (el dominio base pelado, un subdominio de dos niveles) también es 404. La CSP de la carta es estática (`next.config.ts`) para
 *    que la carta siga siendo ISR: acá no se le pone nonce.
 * 2. CSP con nonce por pedido para las pantallas de la aplicación (no para la carta ni para `/api`): ver `core/seguridad/cabeceras.ts`.
 * 3. Recuerda la pantalla pedida cuando NO hay cookie de sesión, para que el login la devuelva ahí al entrar. Sin esto, con la sesión
 *    vencida, una carga directa (F5, un favorito, la URL tipeada) llegaba al login sin saber a dónde volver: el navegador no manda
 *    `Referer` en esos pedidos. No decide nada de seguridad: solo pone un encabezado (siempre lo pisa, así un cliente no lo puede
 *    falsear en estos pedidos) con la ruta pedida, y quien lo usa (`irAlLogin`) la valida como ruta interna. El acceso lo siguen
 *    decidiendo el layout y cada acción.
 */

function respuesta404(): NextResponse {
  const r = new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  for (const { key, value } of cabecerasComunes()) r.headers.set(key, value);
  return r;
}

function rutaPedida(request: NextRequest): string | null {
  try {
    const url = request.nextUrl.clone();
    url.searchParams.delete("_rsc"); // parámetro interno de las navegaciones del cliente: no es parte de la pantalla
    return url.pathname + url.search;
  } catch {
    // Recordar la pantalla es una comodidad: si por algún valor raro no se puede armar, el pedido sigue igual (el login queda sin «volver»).
    return null;
  }
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const dominioBaseCarta = process.env.CARTA_DOMINIO_BASE;
  const host = request.headers.get("host");

  if (esHostDeZonaCarta(host, dominioBaseCarta)) {
    // La carta es de solo lectura: un POST (y con él una Server Action, que viaja con `next-action`) no tiene nada que hacer en este host.
    if (!interpretarHostCarta(host, dominioBaseCarta) || !esPathPermitidoEnHostCarta(pathname) || !esMetodoDeLecturaEnHostCarta(request.method) || request.headers.has("next-action")) return respuesta404();
    return NextResponse.next();
  }

  // Path directo de la carta (instalación sin subdominio, desarrollo, e2e): su CSP estática viene de `next.config.ts`.
  if (pathname === "/carta-publica" || pathname.startsWith("/carta-publica/") || pathname.startsWith("/api/")) return NextResponse.next();

  const headers = new Headers(request.headers);
  const nonce = generarNonce();
  const csp = cspApp({ nonce, desarrollo: process.env.NODE_ENV === "development", https: sirvePorHttps(process.env) });
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  // Siempre se descarta lo que mande el cliente: con sesión (o en /login) el proxy no lo pone, y un valor falseado llegaría tal cual a `irAlLogin`.
  headers.delete(ENCABEZADO_RUTA_PEDIDA);

  const sinSesion = !NOMBRES_COOKIE_SESION.some((nombre) => request.cookies.has(nombre));
  if (sinSesion && pathname !== "/login") {
    const ruta = rutaPedida(request);
    if (ruta) headers.set(ENCABEZADO_RUTA_PEDIDA, ruta);
  }

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Todo menos los archivos estáticos de Next y el favicon (los archivos no son pantallas ni tienen lógica propia).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
