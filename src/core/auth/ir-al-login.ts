import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ENCABEZADO_RUTA_PEDIDA, rutaDesdeReferer, rutaInternaSegura, urlDeLogin } from "@/core/navegacion/volver";

/**
 * Manda a la persona al login, recordando la pantalla en la que estaba para devolverla ahí después de entrar. Lo usan el layout
 * de la app (sin sesión en una navegación o en un refresco) y `conPermiso` (sin sesión al enviar un formulario).
 *
 * La pantalla se toma, en este orden, de:
 * 1. El encabezado `x-motor2-ruta-pedida` que pone `src/proxy.ts` en los pedidos SIN cookie de sesión: es la ruta que se pidió,
 *    también en una carga directa (F5, un favorito, la URL tipeada), donde el navegador no manda `Referer`.
 * 2. El `Referer`: en una Server Action y en un `router.refresh()` es la URL actual (con su consulta); en una navegación con un
 *    enlace es la pantalla desde la que se hizo clic. Cubre a quien tiene cookie pero la sesión ya no vale en la base.
 * Si no hay ninguna, se va al login a secas y después se entra por la pantalla de inicio. Los dos vienen del cliente: solo se
 * acepta una ruta interna de este mismo host (ver `rutaInternaSegura`).
 *
 * `redirect` lanza: quien llama no sigue ejecutándose.
 */
export async function irAlLogin(): Promise<never> {
  const h = await headers();
  const volver = rutaInternaSegura(h.get(ENCABEZADO_RUTA_PEDIDA)) ?? rutaDesdeReferer(h.get("referer"), h.get("x-forwarded-host") ?? h.get("host"));
  redirect(urlDeLogin(volver));
}
