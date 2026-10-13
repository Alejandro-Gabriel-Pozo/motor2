import type { Metadata } from "next";
import { origenPublicoDeCarta, urlCartaPublicaConEmpresaUnica, type MetadatosPublicos } from "@/core/carta/public";

/**
 * El borde de los metadatos de la carta pública (`core/carta/metadatos.ts` arma los textos, esto los convierte en lo que Next entiende) y de las direcciones públicas. Lo usan las páginas
 * de `(carta-publica)` y las rutas de `robots.txt` y `sitemap.xml`.
 *
 * La dirección pública sale de la CONFIGURACIÓN (`CARTA_DOMINIO_BASE`, y el add-on `CARTA_EMPRESA_UNICA_COMPILADO`, la copia que quedó en el build, igual que en el proxy y en el admin) y del slug de la empresa
 * que resolvió el servidor: las páginas son ISR y no ven el `Host`, y aunque lo vieran, un valor del pedido no puede decidir cuál es "la dirección definitiva".
 */

/** Origen público de la carta de una empresa (`https://<empresa>.<dominio base>`), o `null` si la instalación no tiene dominio de cartas. */
export function origenDeLaCarta(empresaSlug: string): string | null {
  return origenPublicoDeCarta(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA_COMPILADO, empresaSlug);
}

/** La dirección pública definitiva del portal (sin `sucursalSlug`) o de la carta de una sucursal, y su origen. `null` los dos sin dominio de cartas. */
export function direccionPublicaDeCarta(empresaSlug: string, sucursalSlug?: string): { origen: string | null; url: string | null } {
  const origen = origenDeLaCarta(empresaSlug);
  return { origen, url: origen ? `${origen}/${sucursalSlug ?? ""}` : null };
}

/**
 * A dónde apunta un enlace de una página pública a otra (portal → carta, carta → portal). Con dominio de cartas real, DIRECTO a la URL final del host de la carta
 * (`https://<empresa>.<dominio>/<sucursal>`): el path técnico `/carta-publica/<empresa>/<sucursal>` redirige (307) ahí y costaba un salto de red en cada toque. Sin dominio, o con
 * `localhost`/`*.localhost` (desarrollo y e2e, donde no hay un host propio al que ir y la página puede estar viéndose por cualquier host), el path técnico, que sirve la carta en el mismo host y
 * que el redirect del host de la carta lleva a la URL limpia. Las páginas son ISR y no ven el `Host`: este es el único criterio posible, y se resuelve con la configuración.
 */
export function hrefDeCartaPublica(empresaSlug: string, sucursalSlug?: string): string {
  return urlCartaPublicaConEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA_COMPILADO, empresaSlug, sucursalSlug);
}

/** `Metadata` de Next para una página pública: título, descripción, dirección canónica, indexable, y las vistas previas de Open Graph y Twitter. La imagen solo si el comercio cargó una. */
export function metadataDeCartaPublica(m: MetadatosPublicos): Metadata {
  const imagenes = m.imagen ? [m.imagen] : undefined;
  return {
    ...(m.origen ? { metadataBase: new URL(m.origen) } : {}),
    title: m.titulo,
    description: m.descripcion,
    ...(m.url ? { alternates: { canonical: m.url } } : {}),
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "es_AR",
      siteName: m.nombreSitio,
      title: m.titulo,
      description: m.descripcion,
      ...(m.url ? { url: m.url } : {}),
      ...(imagenes ? { images: imagenes } : {}),
    },
    twitter: { card: "summary", title: m.titulo, description: m.descripcion, ...(imagenes ? { images: imagenes } : {}) },
  };
}
