import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { cartaPublica, empresaCartaPublica } from "@/server/carta-publica/sin-sesion";
import { CartaVista } from "@/components/carta-publica/carta-vista";

// ISR: se cachea 5 minutos, y las acciones del módulo carta la invalidan al instante (`revalidarCartasPublicas`). Sin
// `generateStaticParams` una ruta con segmentos dinámicos NO entra en ISR (el build la marca ƒ y `revalidate` no hace nada):
// devolver [] la habilita sin prerenderizar ninguna sucursal — cada una se genera en su primera visita.
export const revalidate = 300;

export function generateStaticParams() {
  return [];
}

// `cache` de React: generateMetadata y la página resuelven lo mismo en el mismo pedido; se consulta la base una sola vez.
const resolver = cache(async (empresa: string, sucursal: string) => {
  const empresaCarta = await empresaCartaPublica(empresa);
  if (!empresaCarta) return null;
  // La hora de la carta se fija acá, en el borde (O.22-c): solo alimenta su `generadoEn`.
  return cartaPublica(empresaCarta, sucursal, new Date());
});

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
 * de ruta `[empresa]`, no por el Host (eso es Fase 6, el rewrite de `next.config.ts`).
 *
 * Caché (Fase 4): `revalidate = 300` + `revalidatePath("/(carta-publica)/carta-publica/[empresa]/[sucursal]", "page")` en cada acción de
 * `src/server/actions/carta/` que cambia lo que se ve (ver `revalidar.ts`). Límite conocido: un cambio hecho fuera del módulo
 * carta que la carta muestra (precio, nombre o disponibilidad de un producto) tarda hasta 5 minutos en verse.
 */
export default async function CartaPage({ params }: { params: Promise<{ empresa: string; sucursal: string }> }) {
  const { empresa, sucursal } = await params;
  const resuelta = await resolver(empresa, sucursal);
  if (!resuelta) notFound();

  return <CartaVista carta={resuelta.carta} estilo={resuelta.estilo} hrefVolver={`/carta-publica/${empresa}`} />;
}
