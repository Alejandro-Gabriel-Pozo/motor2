import "server-only";
import type { Prisma } from "@prisma/client";
import { alcanceDeSucursal } from "@/core/catalogo/public";
import type { IngredienteParaVender } from "@/core/movimientos/public";
import { cargarRecetaVigente, cargarRecetasVigentes } from "@/server/lecturas/catalogo/recetas-vigentes";

/**
 * La receta vigente de un PV para venderlo en una sucursal (Hito 5, 5.1-2: mudada TAL CUAL desde `armarLinea`, en `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`):
 * la llamada a `cargarRecetaVigente` y su `include` son los mismos de siempre — receta EFECTIVA de la sucursal (la propia si la tiene habilitada, si no la central), ingredientes por `id`
 * ascendente (determinístico para el libro: de ese orden dependen el reparto del stock y el arrastre de redondeo), sustitutos por `orden` y SOLO las calibraciones locales de ESTA
 * sucursal. Devuelve `[]` si el plato no tiene receta. SIEMPRE con el `tx` de la venta (la lectura es parte de la transacción serializable que arbitra los conflictos).
 */
export async function cargarRecetaVigenteParaVender(tx: Prisma.TransactionClient, { productoId, sucursalId }: { productoId: string; sucursalId: string }): Promise<IngredienteParaVender[]> {
  const receta = await cargarRecetaVigente(tx, alcanceDeSucursal(sucursalId), productoId, {
    include: {
      ingredientes: {
        orderBy: { id: "asc" },
        include: { sustitutos: { orderBy: { orden: "asc" } }, rendimientosLocales: { where: { sucursalId } } },
      },
    },
  });
  return (receta?.ingredientes ?? []).map((ing) => ({
    insumoProductoId: ing.insumoProductoId,
    cantidad: Number(ing.cantidad),
    mermaPorcentaje: Number(ing.mermaPorcentaje),
    rendimientosLocales: ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
    insumoSustitutoIds: ing.sustitutos.map((s) => s.insumoSustitutoId),
  }));
}

// RECETA (ADR-033, sin receta no se vende) ------------------------------------------------------------------------------------------------------------------------------------------

/** Lo que el agregado de ítems del POS necesita de cada PV del pedido para la regla del origen de stock (`rechazoSinOrigenDeStock`, `core/movimientos/origen-de-stock.ts`). */
export interface OrigenDeStockParaVender {
  nombre: string;
  seProduce: boolean;
  /** Ingredientes de la receta EFECTIVA de la sucursal (la propia si la tiene habilitada, si no la central); 0 sin receta. */
  ingredientesDeLaRecetaVigente: number;
}

/**
 * De cada producto pedido (sueltos y componentes de las promos), su nombre, si se produce y cuántos ingredientes tiene su receta VIGENTE en la sucursal: la misma resolución que la venta
 * (`cargarRecetasVigentes` con `alcanceDeSucursal`), en lecturas agrupadas por pedido (los productos y las versiones), no por ítem. Un id que no se ve desde esta empresa no aparece. Sin
 * productos, no consulta. SIEMPRE con el `tx` de quien llama (el agregado de ítems, dentro de su transacción serializable). El cobro vuelve a mirar la receta: esta lectura es el error
 * temprano para el mozo, la barrera final es `armarLinea`.
 */
export async function cargarOrigenDeStockParaVender(
  tx: Prisma.TransactionClient,
  { sucursalId, productoIds }: { sucursalId: string; productoIds: readonly string[] }
): Promise<Map<string, OrigenDeStockParaVender>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const productos = await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, seProduce: true } });
  const recetas = await cargarRecetasVigentes(tx, alcanceDeSucursal(sucursalId), { where: { productoId: { in: ids } }, include: { _count: { select: { ingredientes: true } } } });
  return new Map(productos.map((p) => [p.id, { nombre: p.nombre, seProduce: p.seProduce, ingredientesDeLaRecetaVigente: recetas.get(p.id)?._count.ingredientes ?? 0 }]));
}
