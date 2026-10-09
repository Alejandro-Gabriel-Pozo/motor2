import { notFound } from "next/navigation";
import { configPortalPublica, empresaCartaPublica, portalCartaPublico } from "@/server/carta-publica/sin-sesion";
import { PortalVista } from "@/components/carta-publica/portal-vista";

// Dinámico a propósito (sin caché): ver la nota de abajo.
export const dynamic = "force-dynamic";

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
  const empresaCarta = await empresaCartaPublica(empresa);
  if (!empresaCarta) notFound();

  // S-24: una empresa que no publicó ninguna sucursal (o no tiene el módulo Carta: el portal viene vacío) da el MISMO 404 que un slug inexistente. Si no, esta página
  // es un oráculo para enumerar qué empresas son clientes de la plataforma (y se lleva el nombre comercial de cada una sin que haya publicado nada).
  const sucursales = await portalCartaPublico(empresaCarta);
  if (sucursales.length === 0) notFound();
  const estilo = await configPortalPublica(empresaCarta);
  const slugEmpresa = empresaCarta.slug;
  return (
    <PortalVista
      sucursales={sucursales}
      empresaNombre={empresaCarta.nombre}
      estilo={estilo}
      hrefDe={(slug) => `/carta-publica/${slugEmpresa}/${slug}`}
      modo="publico"
    />
  );
}
