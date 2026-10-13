import { xmlSitemapDeCarta } from "@/core/carta/public";
import { empresaCartaPublica, portalCartaPublico } from "@/server/carta-publica/sin-sesion";
import { CACHE_PUBLICO_DE_LA_CARTA } from "@/core/seguridad/cabeceras";
import { origenDeLaCarta } from "@/components/carta-publica/metadatos";

/**
 * `sitemap.xml` del host público de una empresa: el portal y las sucursales PÚBLICAS, que salen del mismo lector que dibuja el portal (`portalCartaPublico`: publicadas, activas y con el
 * módulo Carta), sin ninguna consulta propia. Sale con el caché público de la CDN (`CACHE_PUBLICO_DE_LA_CARTA`) solo si es 200: el 404 va sin él. Misma regla de 404 que el portal (S-24) y que `robots.txt`; sin dominio de cartas configurado no hay dirección pública que listar y también es 404.
 */
export async function GET(_pedido: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const empresaCarta = await empresaCartaPublica(empresa);
  const sucursales = empresaCarta ? await portalCartaPublico(empresaCarta) : [];
  const origen = empresaCarta ? origenDeLaCarta(empresaCarta.slug) : null;
  if (!empresaCarta || sucursales.length === 0 || !origen) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(xmlSitemapDeCarta(origen, sucursales.map((s) => s.slug)), { headers: { "content-type": "application/xml; charset=utf-8", [CACHE_PUBLICO_DE_LA_CARTA.key]: CACHE_PUBLICO_DE_LA_CARTA.value } });
}
