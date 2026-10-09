import "server-only";
import { armarAlertasStock, resumirAlertasStock, type FilaAlertaStock, type ResumenAlertasStock } from "@/core/stock/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Alertas de stock (port de calcularAlertasStock_, Stock.js:2255-2305): el saldo de cada producto+sección contra su mínimo. La lectura vive acá; la comparación
 * es pura y vive en `core/stock/alertas.ts` (Pureza Fase 3). Lee el Kardex (solo lectura). Sin guarda de permiso adentro: la página la pone antes.
 */
export async function calcularAlertasStock(
  sucursalId: string,
  db: Db,
  /**
   * Lo que quien llama ya leyó, para no volver a leerlo (O.39 de docs/pureza-integracion.md; Salud por producto compone varios reportes que leen lo mismo):
   * productos que INCLUYAN todos los que tienen saldo en la sucursal (se buscan por id: que sobren no cambia nada; p. ej. el catálogo entero) y las
   * secciones de la sucursal (`seccion.findMany({ where: { sucursalId } })`). Lo que falte se lee acá.
   */
  cargado: { productos?: readonly { id: string; codigo: string; nombre: string }[]; secciones?: readonly { id: string; nombre: string }[] } = {}
): Promise<FilaAlertaStock[]> {
  const saldos = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { seccion: { sucursalId } },
    _sum: { cantidad: true },
    _max: { creadoEn: true },
  });
  if (!saldos.length) return [];

  const productoIds = Array.from(new Set(saldos.map((s) => s.productoId)));
  const [productos, secciones, minimos] = await Promise.all([
    cargado.productos ? Promise.resolve(cargado.productos) : db.producto.findMany({ where: { id: { in: productoIds } } }),
    cargado.secciones ? Promise.resolve(cargado.secciones) : db.seccion.findMany({ where: { sucursalId } }),
    db.stockMinimoProducto.findMany({ where: { sucursalId, productoId: { in: productoIds } } }),
  ]);

  return armarAlertasStock({
    saldos: saldos.map((s) => ({ productoId: s.productoId, seccionId: s.seccionId, saldo: Number(s._sum.cantidad ?? 0), ultimaFecha: s._max.creadoEn })),
    productos,
    secciones,
    minimos: minimos.map((m) => ({ productoId: m.productoId, seccionId: m.seccionId, minimo: Number(m.minimo) })),
  });
}

/** Port de obtenerResumenAlertasStock (Stock.js:2329-2340). */
export async function obtenerResumenAlertasStock(sucursalId: string, db: Db): Promise<ResumenAlertasStock> {
  return resumirAlertasStock(await calcularAlertasStock(sucursalId, db));
}
