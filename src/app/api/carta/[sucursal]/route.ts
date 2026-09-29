import { menuCartaPublico } from "@/core/carta/publica-sin-sesion";
import { autorizarServicioCarta, SIN_CACHE } from "@/core/carta/autorizar-servicio";
import { reportarError } from "@/lib/reportar-error";

/**
 * La carta pública de una sucursal, para restaurant-menu-design (docs/plan-carta-catalogo-2026-09-24.md, M5). Solo lectura: el
 * catálogo (PV disponibles acá + su contenido de carta + precio que se cobra) armado con `resolverMenuCarta`. Forma `CartaV1`
 * (src/core/carta/armar-menu.ts), versionada con `version: 1`.
 *
 * `[sucursal]` es `Sucursal.id` (decisión D1). Autenticación de servicio con `Authorization: Bearer <CARTA_API_TOKEN>`, mismo
 * patrón que los crons (`src/app/api/cron/*`): sin la variable responde 401 siempre y se avisa a Sentry una sola vez. El
 * preámbulo vive en `autorizarServicioCarta` (src/core/carta/autorizar-servicio.ts), compartido con GET /api/carta/tenants. `/api`
 * ya queda fuera de `src/proxy.ts`. Solo se exporta GET: los demás métodos responden 405 solos.
 *
 * Firma según la doc de Next 16.3.5 (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md): el
 * segundo argumento trae `params` como PROMESA. Se tipa a mano en vez de con el helper global `RouteContext<...>` porque ese
 * helper solo existe después de `next build`/`next typegen`, y un `tsc --noEmit` en un checkout limpio fallaría por eso.
 */
export async function GET(request: Request, ctx: { params: Promise<{ sucursal: string }> }): Promise<Response> {
  const noAutorizado = await autorizarServicioCarta(request);
  if (noAutorizado) return noAutorizado;

  try {
    const { sucursal } = await ctx.params;
    // Mismo 404 para inexistente e inactiva: quien llama no necesita saber cuál de las dos es.
    const carta = sucursal.length <= 100 ? await menuCartaPublico(sucursal) : null;
    if (!carta) return Response.json({ error: "Sucursal no encontrada" }, { status: 404, headers: SIN_CACHE });
    return Response.json(carta, { headers: SIN_CACHE });
  } catch (e) {
    await reportarError(e, "carta-api");
    // A diferencia de los crons, no se devuelve `e.message`: lo llama un sitio externo.
    return Response.json({ error: "Error interno" }, { status: 500, headers: SIN_CACHE });
  }
}
