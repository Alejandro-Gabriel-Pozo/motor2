import { textoRobotsDeCarta } from "@/core/carta/public";
import { empresaCartaPublica, portalCartaPublico } from "@/server/carta-publica/sin-sesion";
import { CACHE_PUBLICO_DE_LA_CARTA } from "@/core/seguridad/cabeceras";
import { origenDeLaCarta } from "@/components/carta-publica/metadatos";

/**
 * `robots.txt` del host público de una empresa (en `<empresa>.<dominio de cartas>/robots.txt`, por el rewrite de `next.config.ts`; la empresa sale del host que resolvió el rewrite, nunca del pedido). Sale con el caché público de la CDN (`CACHE_PUBLICO_DE_LA_CARTA`) solo si es 200. Mismo
 * criterio que el portal (S-24): una empresa que no existe, o que no publicó ninguna sucursal, da el MISMO 404, para que esta ruta no delate qué empresas son clientes.
 */
export async function GET(_pedido: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const empresaCarta = await empresaCartaPublica(empresa);
  if (!empresaCarta || (await portalCartaPublico(empresaCarta)).length === 0) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(textoRobotsDeCarta(origenDeLaCarta(empresaCarta.slug)), { headers: { "content-type": "text/plain; charset=utf-8", [CACHE_PUBLICO_DE_LA_CARTA.key]: CACHE_PUBLICO_DE_LA_CARTA.value } });
}
