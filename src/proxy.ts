import { NextResponse, type NextRequest } from "next/server";
import { ENCABEZADO_RUTA_PEDIDA } from "@/core/navegacion/volver";

/**
 * Recuerda la pantalla que se pidió cuando NO hay cookie de sesión, para que el login la devuelva ahí al entrar. Sin esto, con la
 * sesión vencida, una carga directa (F5, un favorito, la URL tipeada) llegaba al login sin saber a dónde volver: el navegador no
 * manda `Referer` en esos pedidos, y después se entraba por la pantalla de inicio.
 *
 * Corre SOLO en los pedidos sin cookie de sesión (el `matcher`): quien ya tiene sesión no pasa por acá, no paga nada. No decide
 * nada de seguridad: solo pone un encabezado (siempre lo pisa, así un cliente no lo puede falsear en estos pedidos) con la ruta
 * pedida, y quien lo usa (`irAlLogin`) la valida como ruta interna. El acceso lo siguen decidiendo el layout y cada acción.
 *
 * Los pedidos sin cookie de sesión son los de quien nunca entró o cuya sesión venció y el navegador ya descartó la cookie (vence
 * a las 12 horas sin uso, ver `duracion-sesion.ts`). Si hay cookie pero la sesión ya no existe en la base, se usa el `Referer`.
 * Nombres de la cookie de Auth.js: `authjs.session-token` (http) y `__Secure-authjs.session-token` (https).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const url = request.nextUrl.clone();
  url.searchParams.delete("_rsc"); // parámetro interno de las navegaciones del cliente: no es parte de la pantalla
  headers.set(ENCABEZADO_RUTA_PEDIDA, url.pathname + url.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    {
      // Todas las pantallas y sus Server Actions; no las rutas de la API (Auth.js, cron), los archivos de Next ni el login mismo.
      source: "/((?!api|_next/static|_next/image|favicon.ico|login).*)",
      missing: [
        { type: "cookie", key: "authjs.session-token" },
        { type: "cookie", key: "__Secure-authjs.session-token" },
      ],
    },
  ],
};
