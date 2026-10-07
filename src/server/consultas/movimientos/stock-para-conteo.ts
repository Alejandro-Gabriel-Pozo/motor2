import type { Prisma, PrismaClient } from "@prisma/client";
import { armarFilasStockParaConteo, type FilaStockParaConteo } from "@/core/movimientos/public";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Productos con saldo != 0 en una sección, uno por (producto, lote) — la
 * precarga de la grilla de Conteo Físico (mismo criterio que "Fetch Items
 * from Warehouse" de ERPNext, `stock_reconciliation.py::get_items`: solo
 * lo que ya tiene historial de stock ahí, no el catálogo entero). Excluye
 * PV comunes (mismo filtro que registrarConteoFisico, tieneStockReal) y
 * saldo 0 — nada que verificar ahí; si hay algo real que el sistema no
 * sabe (nunca contado, sin factura), se agrega a mano en la grilla, que sí
 * admite contar sobre saldo 0.
 */
export async function listarStockParaConteo(seccionId: string, db: Db): Promise<FilaStockParaConteo[]> {
  const grupos = await db.movimientoStock.groupBy({
    by: ["productoId", "loteVencimiento"],
    where: { seccionId },
    _sum: { cantidad: true },
  });
  const conSaldo = grupos.filter((g) => Number(g._sum.cantidad ?? 0) !== 0);
  if (!conSaldo.length) return [];

  const productoIds = Array.from(new Set(conSaldo.map((g) => g.productoId)));
  const [productos, seccion] = await Promise.all([
    db.producto.findMany({ where: { id: { in: productoIds } }, include: { unidadStock: true } }),
    db.seccion.findUniqueOrThrow({ where: { id: seccionId }, select: { sucursalId: true } }),
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const disponibilidad = await disponibilidadDeProductos(seccion.sucursalId, productoIds, db);

  return armarFilasStockParaConteo(
    conSaldo.map((g) => ({ productoId: g.productoId, loteVencimiento: g.loteVencimiento, saldo: Number(g._sum.cantidad ?? 0) })),
    productoPorId,
    disponibilidad
  );
}
