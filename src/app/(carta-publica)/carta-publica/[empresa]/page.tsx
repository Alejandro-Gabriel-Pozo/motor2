import { notFound } from "next/navigation";
import { resolverEmpresaCarta } from "@/core/carta/public";
import { portalCartaPublico } from "@/core/carta/publica-sin-sesion";
import { PortalVista } from "@/components/carta-publica/portal-vista";

// Dinámico a propósito (sin caché): ver la nota de abajo.
export const dynamic = "force-dynamic";

/**
 * Portal de sucursales de una empresa (ADR-006, Fase 3): reemplaza `restaurant-menu-design/app/page.tsx`. `notFound()`
 * si el slug de empresa no resuelve — hoy (`resolverEmpresaCarta`) compara contra `CARTA_EMPRESA_SLUG`; cuando `Empresa`
 * exista de verdad (Fase F) esta página no cambia, solo cambia qué hay adentro de esa función.
 *
 * SIN `revalidate`/ISR a propósito (ADR-006, Fase 4): es una lista chica (una consulta) y tiene que estar siempre al día —
 * el registro de sucursales cambia desde el admin y el propio portal `/carta-publica/e2e` es compartido por varios e2e. La
 * página de cada sucursal sí se cachea (con invalidación desde las acciones de carta): `[sucursal]/page.tsx`.
 */
export default async function PortalPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const empresaCarta = await resolverEmpresaCarta(empresa);
  if (!empresaCarta) notFound();

  const sucursales = await portalCartaPublico(empresaCarta);
  return <PortalVista sucursales={sucursales} empresaSlug={empresaCarta.slug} />;
}
