import type { CartaV1 } from "@/core/carta/armar-menu";

/**
 * «Agregar al pedido» del POS organizado por SECCIÓN DE CARTA (docs/plan-selector-carta-pos-2026-09-25.md). Lógica PURA, sin
 * Prisma — la lectura vive en `selector-carta-consulta.ts` (mismo criterio que `armar-menu.ts` / `menu-consulta.ts`): así el
 * componente de cliente puede importar los TIPOS de acá sin arrastrar `@/lib/db` al bundle.
 *
 * OJO con el nombre: esto es la sección de CARTA (`SeccionCarta`, "Platos Principales"), no la sección de STOCK (`Seccion`,
 * "Depósito"). Todo lo de este módulo se llama `…Carta`, nunca `secciones` a secas.
 *
 * Qué decide:
 *  - la ESTRUCTURA sale de la carta pública ya armada (`CartaV1`, de `resolverMenuCarta`): orden de las secciones y de los ítems,
 *    qué producto va dentro de un ítem agrupado y cuál suelto (D3), y el orden de las opciones;
 *  - el PRECIO y el CÓDIGO salen SIEMPRE de `pedibles` (una sola fuente: el precio que se congela al agregar, `precioDeCarta`;
 *    la carta no trae código). Por eso cada opción de un agrupado muestra SU precio, no el del grupo (que es el mayor, D5);
 *  - las promos de la carta se ignoran (no son productos: no se piden). Una sección que queda vacía se descarta;
 *  - «Fuera de carta» (DP1/DP2): todo PV pedible que la carta pública no muestra (no visible, sin sección, sección apagada, dentro
 *    de un agrupado apagado), ordenado por nombre. El mozo sigue pudiendo pedir todo lo que podía pedir antes.
 *
 * Invariante (fijado por test/pos/selector-carta.test.ts): cada pedible aparece EXACTAMENTE una vez (en una sección de carta o en
 * «Fuera de carta»), y ningún id de ítem agrupado (`ItemCartaV1.productoId` de un agrupado, D6) llega nunca como `productoId`: un
 * agrupado se resuelve a una opción concreta ANTES de llamar a `agregarItems`.
 */

/** Un PV que se puede pedir en la sucursal: disponible acá, con el precio que se congelaría al agregarlo. */
export interface ProductoPedible {
  productoId: string;
  codigo: string;
  nombre: string;
  precio: number;
}

export type EntradaSelectorCarta =
  | { tipo: "producto"; producto: ProductoPedible }
  | {
      tipo: "agrupado";
      /** El id del ítem agrupado de la carta: NUNCA es un `productoId` y nunca viaja a `agregarItems`. */
      itemAgrupadoCartaId: string;
      nombre: string;
      precioMinimo: number;
      precioMaximo: number;
      /** Los PV reales, en el orden de la carta, con su propio precio. Nunca vacío. */
      opciones: ProductoPedible[];
    };

export interface SeccionSelectorCarta {
  seccionCartaId: string;
  nombre: string;
  /** Nunca vacío. */
  entradas: EntradaSelectorCarta[];
}

export interface SelectorCartaPos {
  /** Las secciones de carta, en el orden de la carta. Vacío = el POS no dibuja el navegador por secciones (DP3). */
  seccionesCarta: SeccionSelectorCarta[];
  /** Los pedibles que la carta pública no muestra, ordenados por nombre. */
  fueraDeCarta: ProductoPedible[];
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

export function armarSelectorCartaPos(carta: CartaV1 | null, pedibles: readonly ProductoPedible[]): SelectorCartaPos {
  const pediblePorId = new Map(pedibles.map((p) => [p.productoId, p]));
  const ubicados = new Set<string>();
  /** El pedible, si existe y todavía no se ubicó (un `productoId` repetido se ubica una sola vez). */
  const tomar = (productoId: string): ProductoPedible | null => {
    const p = pediblePorId.get(productoId);
    if (!p || ubicados.has(productoId)) return null;
    ubicados.add(productoId);
    return p;
  };

  const seccionesCarta: SeccionSelectorCarta[] = [];
  for (const seccion of carta?.secciones ?? []) {
    const entradas: EntradaSelectorCarta[] = [];
    for (const item of seccion.items) {
      if (item.opciones) {
        const opciones = item.opciones.flatMap((o) => {
          const p = tomar(o.productoId);
          return p ? [p] : [];
        });
        if (opciones.length === 0) continue;
        const precios = opciones.map((o) => o.precio);
        entradas.push({
          tipo: "agrupado",
          itemAgrupadoCartaId: item.productoId,
          nombre: item.nombre,
          precioMinimo: Math.min(...precios),
          precioMaximo: Math.max(...precios),
          opciones,
        });
        continue;
      }
      const p = tomar(item.productoId);
      if (p) entradas.push({ tipo: "producto", producto: p });
    }
    if (entradas.length > 0) seccionesCarta.push({ seccionCartaId: seccion.id, nombre: seccion.nombre, entradas });
  }

  // Lo que la carta no ubicó. `tomar` también deduplica acá: un pedible repetido en la entrada va una sola vez.
  const fueraDeCarta = [...pediblePorId.keys()].flatMap((productoId) => {
    const p = tomar(productoId);
    return p ? [p] : [];
  });
  return { seccionesCarta, fueraDeCarta: fueraDeCarta.sort((a, b) => comparar(a.nombre, b.nombre)) };
}
