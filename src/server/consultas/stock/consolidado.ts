import "server-only";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { armarStockConsolidado, movimientosPorLeer, type FilaStockConsolidado, type MovimientoPosteriorAlConteo } from "@/core/stock/public";
import type { Db } from "@/lib/db-tipos";

/** Cuántas claves se piden por consulta: cada una agrega 4 parámetros y Postgres limita a 65.535 por sentencia. */
const CLAVES_POR_CONSULTA = 500;

/**
 * Stock consolidado de una sucursal (port de calcularStockConsolidado_, Stock.js:692-794): todo producto elegible del catálogo aparece, tenga o no
 * movimientos o conteo. La lectura vive acá; el armado de las filas es puro y vive en `core/stock/consolidado.ts` (Pureza Fase 3). Lee el Kardex (solo lectura).
 * Sin guarda de permiso adentro: la página la pone antes.
 *
 * Los movimientos posteriores al último conteo de cada clave (producto + sección + lote) se leen en LOTE: antes era una consulta por cada clave con conteo
 * (un N+1 que crecía con los conteos); ahora una consulta cada `CLAVES_POR_CONSULTA` claves.
 */
export async function calcularStockConsolidado(sucursalId: string, db: Db): Promise<FilaStockConsolidado[]> {
  const productos = await db.producto.findMany({
    where: whereDisponibleEn(sucursalId),
    include: { unidadStock: true, insumo: true },
  });

  const teoricoCrudo = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId", "loteVencimiento"],
    where: { producto: whereDisponibleEn(sucursalId), seccion: { sucursalId } },
    _sum: { cantidad: true },
  });
  const teorico = teoricoCrudo.map((t) => ({ productoId: t.productoId, seccionId: t.seccionId, loteVencimiento: t.loteVencimiento, saldo: Number(t._sum.cantidad ?? 0) }));

  const secciones = await db.seccion.findMany({ where: { sucursalId } });

  // Del más nuevo al más viejo: el armado se queda con el primero válido de cada clave.
  const conteosCrudos = await db.conteoFisico.findMany({
    where: { sucursalId },
    orderBy: { fecha: "desc" },
  });
  const conteos = conteosCrudos.map((c) => ({
    productoId: c.productoId,
    seccionId: c.seccionId,
    loteVencimiento: c.loteVencimiento,
    estado: c.estado,
    fecha: c.fecha,
    conteoReal: Number(c.conteoReal),
    diferencia: Number(c.diferencia),
  }));

  const movimientos: MovimientoPosteriorAlConteo[] = [];
  const porLeer = movimientosPorLeer(teorico, conteos);
  for (let i = 0; i < porLeer.length; i += CLAVES_POR_CONSULTA) {
    const tanda = porLeer.slice(i, i + CLAVES_POR_CONSULTA);
    const filas = await db.movimientoStock.findMany({
      where: { OR: tanda.map((k) => ({ productoId: k.productoId, seccionId: k.seccionId, loteVencimiento: k.loteVencimiento, creadoEn: { gt: k.despuesDe } })) },
      select: { productoId: true, seccionId: true, loteVencimiento: true, creadoEn: true, cantidad: true },
    });
    for (const m of filas) {
      movimientos.push({ productoId: m.productoId, seccionId: m.seccionId, loteVencimiento: m.loteVencimiento, fecha: m.creadoEn, cantidad: Number(m.cantidad) });
    }
  }

  return armarStockConsolidado({ productos, teorico, secciones, conteos, movimientos });
}
