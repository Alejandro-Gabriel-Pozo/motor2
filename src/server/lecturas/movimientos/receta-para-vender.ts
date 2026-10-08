import "server-only";
import type { Prisma } from "@prisma/client";
import { alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";

/**
 * Un ingrediente de la receta VIGENTE de un PV, ya en números planos (los `Decimal` de Prisma convertidos con `Number()` acá, en el borde de la lectura): lo que `armarLinea` necesita
 * para validar la materia prima y calcular lo que consume la venta. `rendimientosLocales` trae SOLO las calibraciones de la sucursal que vende (el `where` de la lectura); `cantidad` y
 * `mermaPorcentaje` son los CENTRALES — el efectivo lo resuelve `rendimientoEfectivo` (D2, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md).
 */
interface IngredienteParaVender {
  insumoProductoId: string;
  cantidad: number;
  mermaPorcentaje: number;
  rendimientosLocales: { sucursalId: string; cantidad: number | null; mermaPorcentaje: number | null }[];
  /** Insumos sustitutos declarados en ESTA línea de receta, en orden (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D1). */
  insumoSustitutoIds: string[];
}

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
