import { resolverRegistroTenants } from "@/core/carta/registro-consulta";
import { autorizarServicioCarta, SIN_CACHE } from "@/core/carta/autorizar-servicio";
import { reportarError } from "@/lib/reportar-error";

/**
 * Registro de tenants del portal para restaurant-menu-design (docs/plan-registro-tenants-2026-09-24.md, M4): lo que hoy es la tab
 * "tenant" de su sheet maestra, armado desde `SucursalPublica` con `resolverRegistroTenants`. Solo lectura. Forma
 * `RegistroTenantsV1` (src/core/carta/registro-tenants.ts), versionada con `version: 1`.
 *
 * La lista es COMPLETA (D4): también las filas no publicadas o de una sucursal inactiva, con `activo: false`, porque la carta
 * combina tenant por tenant y una fila que motor2 conoce le gana a la de la sheet (D7). Lista vacía = 200 `{ tenants: [] }`
 * ("ningún tenant migrado todavía"), nunca 404.
 *
 * Misma autenticación de servicio que GET /api/carta/[sucursal] (D5): `autorizarServicioCarta`. Solo se exporta GET: los demás
 * métodos responden 405 solos.
 *
 * Ruta y firma verificadas contra Next 16.3.5: el segmento estático `tenants` le gana al dinámico `[sucursal]` hermano
 * (node_modules/next/dist/docs/02-pages/03-building-your-application/01-routing/07-api-routes.md, "Predefined API routes take
 * precedence over dynamic API routes"; en el App Router lo implementa el mismo ordenamiento,
 * node_modules/next/dist/shared/lib/router/utils/sorted-routes.js, que ubica los hijos estáticos antes que `[slug]`; lo
 * comprueba test/e2e/api-carta-tenants.spec.ts contra el build). Sin segmentos dinámicos, `GET` recibe solo el `Request`
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md: `context` es opcional). Desde Next 15 un
 * `GET` es dinámico por defecto (mismo archivo, historial de versiones).
 */
export async function GET(request: Request): Promise<Response> {
  const noAutorizado = await autorizarServicioCarta(request);
  if (noAutorizado) return noAutorizado;

  try {
    return Response.json(await resolverRegistroTenants(), { headers: SIN_CACHE });
  } catch (e) {
    await reportarError(e, "carta-api");
    // No se devuelve `e.message`: lo llama un sitio externo.
    return Response.json({ error: "Error interno" }, { status: 500, headers: SIN_CACHE });
  }
}
