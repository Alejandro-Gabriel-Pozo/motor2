import { notFound } from "next/navigation";
import { resolverEmpresaCarta } from "@/core/carta/public";
import { resolverPortalCarta } from "@/core/carta/public-servidor";
import { PortalVista } from "@/components/carta-publica/portal-vista";

// Forzado dinámico (sin caché): ver la nota de abajo sobre por qué no hay `revalidate` todavía.
export const dynamic = "force-dynamic";

/**
 * Portal de sucursales de una empresa (ADR-006, Fase 3): reemplaza `restaurant-menu-design/app/page.tsx`. `notFound()`
 * si el slug de empresa no resuelve — hoy (`resolverEmpresaCarta`) compara contra `CARTA_EMPRESA_SLUG`; cuando `Empresa`
 * exista de verdad (Fase F) esta página no cambia, solo cambia qué hay adentro de esa función.
 *
 * SIN `revalidate`/ISR a propósito por ahora (se probó con 300s y se sacó): todavía no hay ningún `revalidatePath` que
 * invalide el caché cuando cambia el registro de sucursales (Server Actions de `src/server/actions/carta/registro-
 * publico.ts`) — cachear sin forma de invalidar es peor que no cachear (los cambios tardarían hasta 5 minutos en verse,
 * en vez de al instante como en el resto de la administración). Sumar `revalidatePath` a esas acciones y volver a poner
 * `revalidate` es trabajo pendiente, no de esta fase.
 */
export default async function PortalPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const empresaCarta = await resolverEmpresaCarta(empresa);
  if (!empresaCarta) notFound();

  const sucursales = await resolverPortalCarta();
  return <PortalVista sucursales={sucursales} empresaSlug={empresaCarta.slug} />;
}
