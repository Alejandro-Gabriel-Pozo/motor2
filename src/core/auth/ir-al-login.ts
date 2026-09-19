import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rutaDesdeReferer, urlDeLogin } from "@/core/navegacion/volver";

/**
 * Manda a la persona al login, recordando la pantalla en la que estaba para devolverla ahí después de entrar. Lo usan el layout
 * de la app (sin sesión en una navegación o en un refresco) y `conPermiso` (sin sesión al enviar un formulario).
 *
 * La pantalla se toma del encabezado `Referer`: en una Server Action y en un `router.refresh()` es la URL actual (con su
 * consulta); en una navegación con un enlace es la pantalla desde la que se hizo clic. En una carga directa (F5, un favorito,
 * la URL tipeada) no hay `Referer` de esta aplicación y se va al login a secas: después se entra por la pantalla de inicio.
 * Solo se acepta una ruta interna de este mismo host (ver `rutaInternaSegura`).
 *
 * `redirect` lanza: quien llama no sigue ejecutándose.
 */
export async function irAlLogin(): Promise<never> {
  const h = await headers();
  const volver = rutaDesdeReferer(h.get("referer"), h.get("x-forwarded-host") ?? h.get("host"));
  redirect(urlDeLogin(volver));
}
