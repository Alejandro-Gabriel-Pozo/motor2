import type { PrismaClient, TipoProducto } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * "Uso" (Catalogo.js:1053-1062) ya no se persiste — es 100% derivable de
 * `tipo` desde la sesión "eliminar COMPRA+VENTA" (Catalogo.js:1035-1052):
 * una MP siempre se compra, un PV siempre se vende. Sin esta función no
 * hay forma de reconstruir el dato para mostrarlo en la UI.
 */
export function usoDeTipo(tipo: TipoProducto): "COMPRA" | "VENTA" {
  return tipo === "MP" ? "COMPRA" : "VENTA";
}

/**
 * Todos los productos ACTIVOS del mismo Insumo tienen que compartir
 * exactamente la misma unidadStock — equivalente de validarUnidadInsumo_
 * (Catalogo.js:4112-4127). Bug real que esto cierra: sumar "Manteca 5kg" en
 * GR + "Manteca x10" en KG daba un total sin sentido sin aviso.
 *
 * `productoIdExcluir` se usa al editar un producto existente, para no
 * comparar la fila contra sí misma.
 */
export async function validarUnidadInsumo(
  insumoId: string | null | undefined,
  unidadStockId: string,
  productoIdExcluir?: string,
  db: PrismaClient = prisma
): Promise<string | null> {
  if (!insumoId) return null; // sin Insumo asignado, no hay nada que comparar

  const otro = await db.producto.findFirst({
    where: {
      insumoId,
      activo: true,
      unidadStockId: { not: unidadStockId },
      ...(productoIdExcluir ? { id: { not: productoIdExcluir } } : {}),
    },
    select: { nombre: true, unidadStock: { select: { nombre: true } } },
  });
  if (!otro) return null;

  return `Este Insumo ya tiene productos activos con otra unidad de stock (ej. "${otro.nombre}" en ${otro.unidadStock.nombre}) — todos los productos del mismo Insumo deben compartir la misma unidad de stock.`;
}
