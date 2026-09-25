import { resolverTemaCarta } from "@/core/carta/tema-consulta";
import { autorizarServicioCarta, SIN_CACHE } from "@/core/carta/autorizar-servicio";
import { reportarError } from "@/lib/reportar-error";

/**
 * El tema visual de la carta pública de una sucursal, para restaurant-menu-design (docs/plan-tema-carta-2026-09-24.md, M5, D6): lo
 * que hoy es la tab "Config" de la sheet del tenant, armado con `resolverTemaCarta`. Solo lectura. Forma `TemaCartaV1`
 * (src/core/carta/tema.ts), versionada con `version: 1`: SIEMPRE las 67 claves del catálogo, con `null` en las no cargadas.
 *
 * `[sucursal]` es `Sucursal.id`, igual que GET /api/carta/[sucursal] (que no se toca). Misma autenticación de servicio
 * (`autorizarServicioCarta`, `Authorization: Bearer <CARTA_API_TOKEN>`). Mismo 404 para: sucursal inexistente o inactiva, sin
 * fila de tema, tema sin aplicar (borrador) o id de más de 100 caracteres — la carta, ante cualquiera de ellos, sigue con la sheet.
 * Solo se exporta GET: los demás métodos responden 405 solos.
 *
 * Ruta y firma verificadas contra Next 16.3.5: un route handler se puede anidar en cualquier lugar de `app/`, también bajo un
 * segmento dinámico que tiene su propio `route.ts` (solo choca con un `page` en el MISMO segmento;
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md, "Route Resolution"), y `params` es una PROMESA con
 * los segmentos dinámicos de los padres (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md,
 * ejemplo `app/shop/[tag]/[item]/route.js`). Se tipa a mano, como en `[sucursal]/route.ts`, porque el helper global
 * `RouteContext<...>` solo existe después de `next build`/`next typegen`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ sucursal: string }> }): Promise<Response> {
  const noAutorizado = await autorizarServicioCarta(request);
  if (noAutorizado) return noAutorizado;

  try {
    const { sucursal } = await ctx.params;
    const tema = sucursal.length <= 100 ? await resolverTemaCarta(sucursal) : null;
    if (!tema) return Response.json({ error: "Tema no encontrado" }, { status: 404, headers: SIN_CACHE });
    return Response.json(tema, { headers: SIN_CACHE });
  } catch (e) {
    await reportarError(e, "carta-api");
    // No se devuelve `e.message`: lo llama un sitio externo.
    return Response.json({ error: "Error interno" }, { status: 500, headers: SIN_CACHE });
  }
}
