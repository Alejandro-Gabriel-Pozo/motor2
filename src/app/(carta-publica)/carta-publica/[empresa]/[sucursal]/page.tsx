import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { descripcionDeCartaDeSucursal, imagenParaCompartir, MARCA_PUBLICA, tituloDeCartaDeSucursal } from "@/core/carta/public";
import { cartaPublica, empresaCartaPublica } from "@/server/carta-publica/sin-sesion";
import { CartaVista } from "@/components/carta-publica/carta-vista";
import { direccionPublicaDeCarta, hrefDeCartaPublica, metadataDeCartaPublica } from "@/components/carta-publica/metadatos";

// ISR: se cachea 60 segundos, y las acciones del módulo carta (y las del catálogo que cambian lo que la carta muestra) la invalidan al instante (`revalidarCartasPublicas`). Sin
// `generateStaticParams` una ruta con segmentos dinámicos NO entra en ISR (el build la marca ƒ y `revalidate` no hace nada):
// devolver [] la habilita sin prerenderizar ninguna sucursal — cada una se genera en su primera visita.
export const revalidate = 60;

export function generateStaticParams() {
  return [];
}

// `cache` de React: generateMetadata y la página resuelven lo mismo en el mismo pedido; se consulta la base una sola vez.
const resolver = cache(async (empresa: string, sucursal: string) => {
  const empresaCarta = await empresaCartaPublica(empresa);
  if (!empresaCarta) return null;
  // La hora de la carta se fija acá, en el borde (O.22-c): solo alimenta su `generadoEn`.
  const entregada = await cartaPublica(empresaCarta, sucursal, new Date());
  return entregada ? { ...entregada, empresa: empresaCarta } : null;
});

/**
 * Buscadores y vistas previas: el título y la descripción salen del nombre que el comercio le puso a la carta (o el de la sucursal) y de la marca fija (`MARCA_PUBLICA`); la dirección canónica es la del host
 * público definitivo (`<empresa>.<dominio de cartas>/<sucursal>`), no la ruta técnica `/carta-publica/...`. Una carta que no resuelve no define nada: la página da 404 y queda el neutro del layout.
 */
export async function generateMetadata({ params }: { params: Promise<{ empresa: string; sucursal: string }> }): Promise<Metadata> {
  const { empresa, sucursal } = await params;
  const resuelta = await resolver(empresa, sucursal);
  if (!resuelta) return {};
  const { carta, estilo } = resuelta;
  const nombre = estilo.valores.restaurante_nombre || carta.sucursal.nombre;
  return metadataDeCartaPublica({
    titulo: tituloDeCartaDeSucursal(nombre),
    descripcion: descripcionDeCartaDeSucursal({
      nombre,
      descripcionPropia: estilo.valores.restaurante_descripcion,
      secciones: carta.secciones.filter((s) => s.items.length > 0 || s.promos.length > 0).map((s) => s.titulo || s.nombre),
    }),
    ...direccionPublicaDeCarta(resuelta.empresa.slug, sucursal),
    nombreSitio: MARCA_PUBLICA,
    imagen: imagenParaCompartir(estilo.valores.hero_imagen_fondo_url) ?? imagenParaCompartir(estilo.valores.restaurante_logo_url),
  });
}

/**
 * La carta de una sucursal (ADR-006, Fase 3): reemplaza `restaurant-menu-design/app/carta/[sucursal]/page.tsx`. Un slug de
 * sucursal inexistente, no publicado, de una sucursal inactiva, o una empresa que no resuelve, dan el mismo 404 — no se
 * distingue cuál caso es (mismo criterio que hoy). Sin `headers()`/`cookies()` acá: la empresa se resuelve por el segmento
 * de ruta `[empresa]`, no por el Host (eso es Fase 6, el rewrite de `next.config.ts`).
 *
 * Caché (Fase 4): `revalidate = 60` + (S-26) la etiqueta de caché DE LA EMPRESA con que `cartaPublica` marca la carta (`revalidarCartasPublicas(empresaSlug)` la invalida, y solo la de esa empresa) en cada acción de
 * `src/server/actions/carta/` y del catálogo que cambia lo que se ve (ver `revalidar.ts`). Un cambio por una vía que no la llame (precio, nombre o disponibilidad de un producto) se ve a los 60 segundos como mucho.
 */
export default async function CartaPage({ params }: { params: Promise<{ empresa: string; sucursal: string }> }) {
  const { empresa, sucursal } = await params;
  const resuelta = await resolver(empresa, sucursal);
  if (!resuelta) notFound();

  return <CartaVista carta={resuelta.carta} estilo={resuelta.estilo} hrefVolver={hrefDeCartaPublica(resuelta.empresa.slug)} />;
}
