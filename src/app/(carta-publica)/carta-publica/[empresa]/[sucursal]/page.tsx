import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolverEmpresaCarta } from "@/core/carta/public";
import { resolverCartaPublica } from "@/core/carta/public-servidor";
import { CartaVista } from "@/components/carta-publica/carta-vista";

// Forzado dinámico (sin caché): ver la nota de abajo y en carta-publica/[empresa]/page.tsx.
export const dynamic = "force-dynamic";

async function resolver(empresa: string, sucursal: string) {
  const empresaCarta = await resolverEmpresaCarta(empresa);
  if (!empresaCarta) return null;
  return resolverCartaPublica(sucursal);
}

export async function generateMetadata({ params }: { params: Promise<{ empresa: string; sucursal: string }> }): Promise<Metadata> {
  const { empresa, sucursal } = await params;
  const resuelta = await resolver(empresa, sucursal);
  const nombre = resuelta?.estilo.valores.restaurante_nombre || resuelta?.carta.sucursal.nombre;
  return { title: nombre ? `${nombre} · Carta` : "Carta" };
}

/**
 * La carta de una sucursal (ADR-006, Fase 3): reemplaza `restaurant-menu-design/app/carta/[sucursal]/page.tsx`. Un slug de
 * sucursal inexistente, no publicado, de una sucursal inactiva, o una empresa que no resuelve, dan el mismo 404 — no se
 * distingue cuál caso es (mismo criterio que hoy). Sin `headers()`/`cookies()` acá: la empresa se resuelve por el segmento
 * de ruta `[empresa]`, no por el Host (eso es Fase 6, el rewrite de `next.config.ts`). Sin `revalidate`/ISR a propósito
 * por ahora — ver la nota en `carta-publica/[empresa]/page.tsx` (falta el `revalidatePath` que lo invalidaría).
 */
export default async function CartaPage({ params }: { params: Promise<{ empresa: string; sucursal: string }> }) {
  const { empresa, sucursal } = await params;
  const resuelta = await resolver(empresa, sucursal);
  if (!resuelta) notFound();

  return <CartaVista carta={resuelta.carta} estilo={resuelta.estilo} hrefVolver={`/carta-publica/${empresa}`} />;
}
