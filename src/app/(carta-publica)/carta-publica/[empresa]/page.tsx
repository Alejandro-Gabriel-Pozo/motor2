import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { descripcionDelPortal, imagenParaCompartir, MARCA_PUBLICA, tituloDelPortal } from "@/core/carta/public";
import { configPortalPublica, empresaCartaPublica, portalCartaPublico } from "@/server/carta-publica/sin-sesion";
import { PortalVista } from "@/components/carta-publica/portal-vista";
import { direccionPublicaDeCarta, hrefDeCartaPublica, metadataDeCartaPublica } from "@/components/carta-publica/metadatos";

// Dinámico a propósito (sin caché): ver la nota de abajo.
export const dynamic = "force-dynamic";

// `cache` de React: `generateMetadata` y la página resuelven lo mismo en el mismo pedido; se consulta la base una sola vez.
const resolver = cache(async (empresa: string) => {
  const empresaCarta = await empresaCartaPublica(empresa);
  if (!empresaCarta) return null;
  // S-24: una empresa que no publicó ninguna sucursal (o no tiene el módulo Carta: el portal viene vacío) da el MISMO 404 que un slug inexistente. Si no, esta página
  // es un oráculo para enumerar qué empresas son clientes de la plataforma (y se lleva el nombre comercial de cada una sin que haya publicado nada).
  const sucursales = await portalCartaPublico(empresaCarta);
  if (sucursales.length === 0) return null;
  return { empresa: empresaCarta, sucursales, estilo: await configPortalPublica(empresaCarta) };
});

/** Buscadores y vistas previas: el nombre es la marca (o el título que cargó en el portal), la descripción lista sus sucursales y la dirección canónica es la del host público. */
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  const { empresa } = await params;
  const resuelta = await resolver(empresa);
  if (!resuelta) return {};
  return metadataDeCartaPublica({
    titulo: tituloDelPortal(resuelta.estilo.valores.portal_titulo),
    descripcion: descripcionDelPortal(resuelta.sucursales.map((s) => s.etiqueta)),
    ...direccionPublicaDeCarta(resuelta.empresa.slug),
    nombreSitio: MARCA_PUBLICA,
    imagen: imagenParaCompartir(resuelta.estilo.valores.empresa_logo_url),
  });
}

/**
 * Portal de sucursales de una empresa (ADR-006, Fase 3): reemplaza `restaurant-menu-design/app/page.tsx`. `notFound()`
 * si el slug no corresponde a una `Empresa` ACTIVE (ADR-007, A3: la empresa sale de la base, no de una variable de entorno) y, desde
 * S-24, también si la empresa no tiene ninguna sucursal publicada y activa: el mismo 404, para que la página no delate qué empresas son clientes.
 *
 * SIN `revalidate`/ISR a propósito (ADR-006, Fase 4): es una lista chica (una consulta) y tiene que estar siempre al día —
 * el registro de sucursales cambia desde el admin y el propio portal `/carta-publica/e2e` es compartido por varios e2e. La
 * página de cada sucursal sí se cachea (con invalidación desde las acciones de carta): `[sucursal]/page.tsx`.
 */
export default async function PortalPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const resuelta = await resolver(empresa);
  if (!resuelta) notFound();
  const slugEmpresa = resuelta.empresa.slug;
  return (
    <PortalVista
      sucursales={resuelta.sucursales}
      empresaNombre={resuelta.empresa.nombre}
      estilo={resuelta.estilo}
      hrefDe={(slug) => hrefDeCartaPublica(slugEmpresa, slug)}
      modo="publico"
    />
  );
}
