import type { Prisma, PrismaClient } from "@prisma/client";
import { redondearACantidadDeUnidad, tieneStockReal } from "@/core/movimientos/public";
import { disponibilidadDeProductos } from "@/core/catalogo/public-servidor";

type Db = PrismaClient | Prisma.TransactionClient;

export interface FilaStockParaConteo {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadStockNombre: string;
  loteVencimiento: Date | null;
  saldoSistema: number;
}

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

  const filas: FilaStockParaConteo[] = [];
  for (const g of conSaldo) {
    const p = productoPorId.get(g.productoId);
    if (!p || !disponibilidad.get(p.id) || !tieneStockReal(p.tipo, p.seProduce)) continue;
    filas.push({
      productoId: p.id,
      productoCodigo: p.codigo,
      productoNombre: p.nombre,
      unidadStockNombre: p.unidadStock.nombre,
      loteVencimiento: g.loteVencimiento,
      saldoSistema: redondearACantidadDeUnidad(Number(g._sum.cantidad ?? 0), p.unidadStock.decimales),
    });
  }

  filas.sort(
    (a, b) =>
      a.productoNombre.localeCompare(b.productoNombre, "es") ||
      (a.loteVencimiento?.getTime() ?? -Infinity) - (b.loteVencimiento?.getTime() ?? -Infinity)
  );
  return filas;
}
