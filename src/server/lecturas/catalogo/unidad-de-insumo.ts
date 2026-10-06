import "server-only";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public-servidor";
import type { Db } from "@/lib/db-tipos";

/**
 * Todos los productos DISPONIBLES (en alguna sucursal — §5.6, catálogo
 * central) del mismo Insumo tienen que compartir exactamente la misma
 * unidadStock — equivalente de validarUnidadInsumo_ (Catalogo.js:4112-4127).
 * Bug real que esto cierra: sumar "Manteca 5kg" en GR + "Manteca x10" en KG
 * daba un total sin sentido sin aviso.
 *
 * `productoIdExcluir` se usa al editar un producto existente, para no
 * comparar la fila contra sí misma.
 */
export async function validarUnidadInsumo(
  insumoId: string | null | undefined,
  unidadStockId: string,
  productoIdExcluir: string | undefined,
  db: Db
): Promise<string | null> {
  if (!insumoId) return null; // sin Insumo asignado, no hay nada que comparar

  const otro = await db.producto.findFirst({
    where: {
      insumoId,
      ...whereDisponibleEnAlguna(),
      unidadStockId: { not: unidadStockId },
      ...(productoIdExcluir ? { id: { not: productoIdExcluir } } : {}),
    },
    select: { nombre: true, unidadStock: { select: { nombre: true } } },
  });
  if (!otro) return null;

  return `Este Insumo ya tiene productos disponibles con otra unidad de stock (ej. "${otro.nombre}" en ${otro.unidadStock.nombre}) — todos los productos del mismo Insumo deben compartir la misma unidad de stock.`;
}

/**
 * Mismo criterio que validarUnidadInsumo, pero para fusionar un Insumo
 * dentro de otro (renombrarOFusionarInsumo): valida CADA unidad de stock
 * distinta que tengan los productos disponibles del insumo origen contra el
 * destino, antes de mover nada — evita que la fusión mezcle unidades de
 * stock distintas bajo el mismo Insumo (el mismo bug que validarUnidadInsumo
 * evita al editar un producto suelto, pero acá ocurre en masa).
 */
export async function validarFusionInsumos(
  insumoOrigenId: string,
  insumoDestinoId: string,
  db: Db
): Promise<string | null> {
  const unidadesOrigen = await db.producto.findMany({
    where: { insumoId: insumoOrigenId, ...whereDisponibleEnAlguna() },
    select: { unidadStockId: true },
    distinct: ["unidadStockId"],
  });

  for (const { unidadStockId } of unidadesOrigen) {
    const invalido = await validarUnidadInsumo(insumoDestinoId, unidadStockId, undefined, db);
    if (invalido) return invalido;
  }
  return null;
}
