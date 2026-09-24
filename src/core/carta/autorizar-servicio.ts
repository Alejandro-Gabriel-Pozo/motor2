import { tokenDeServicioValido } from "./token-servicio";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

/** Las respuestas de los endpoints de la carta nunca se cachean: las lee un servidor externo con su propia caché (ISR). */
export const SIN_CACHE = { "Cache-Control": "no-store" } as const;

/**
 * Preámbulo de autenticación de servicio de los endpoints que lee restaurant-menu-design (`GET /api/carta/[sucursal]` y
 * `GET /api/carta/tenants`; docs/plan-registro-tenants-2026-09-24.md, M4, D5): `Authorization: Bearer <CARTA_API_TOKEN>`,
 * comparado con `tokenDeServicioValido`. Devuelve la respuesta 401 lista para devolver, o `null` si quien llama está autorizado.
 *
 * Sin la variable responde 401 siempre y se avisa a Sentry UNA sola vez (la clave es la misma para los dos endpoints: es un
 * único problema de configuración). El cuerpo del 401 es siempre el mismo, para no revelar cuál de los dos casos es.
 */
export async function autorizarServicioCarta(request: Request): Promise<Response | null> {
  const esperado = process.env.CARTA_API_TOKEN;
  // Un proyecto sin CARTA_API_TOKEN deja a la carta pública sin datos (cae a su respaldo) y en silencio: se avisa.
  if (!esperado?.trim()) {
    await reportarErrorUnaVez("carta-api-sin-token", new Error("CARTA_API_TOKEN no está configurada: la carta pública no puede leer el catálogo"), "carta-api");
    return Response.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  }
  if (!tokenDeServicioValido(request.headers.get("authorization"), esperado)) {
    return Response.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  }
  return null;
}
