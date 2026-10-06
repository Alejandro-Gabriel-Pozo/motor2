import { NextResponse, type NextRequest } from "next/server";
import { azarDelProceso } from "@/lib/azar";
import { sirvePorHttps } from "@/core/auth/cookie-sesion";
import { cspApp, generarNonce } from "@/core/seguridad/cabeceras";

/**
 * CSP con nonce por pedido (como la aplicación, ver `src/proxy.ts`), pero sin ningún destino de formulario ajeno: la consola no tiene login con
 * Google ni redirige a nadie, así que sus formularios solo pueden enviar a ella misma. El acceso lo deciden las páginas y cada acción.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const nonce = generarNonce(azarDelProceso);
  const csp = cspApp({ nonce, desarrollo: process.env.NODE_ENV === "development", https: sirvePorHttps(process.env), destinosDeFormulario: [] });
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
