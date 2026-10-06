import "server-only";
import { armarStockPorFamilia, type FilaStockPorFamilia } from "@/core/stock/public";
import { cargarArbolDeGrupos } from "@/server/lecturas/catalogo/grupos";
import type { Db } from "@/lib/db-tipos";

/**
 * Stock por familia (Insumo) y sección. La lectura vive acá; el agrupado es puro y vive en `core/stock/por-familia.ts` (Pureza Fase 3). El árbol de grupos
 * se lee UNA vez (antes: una consulta `findFirst` por grupo y una `findUnique` por cada nivel de su cadena). Sin guarda de permiso adentro: la página la pone antes.
 */
export async function calcularStockPorFamilia(sucursalId: string, db: Db): Promise<FilaStockPorFamilia[]> {
  const filas = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { seccion: { sucursalId }, producto: { tipo: "MP" } },
    _sum: { cantidad: true },
  });
  if (!filas.length) return [];

  const productoIds = Array.from(new Set(filas.map((f) => f.productoId)));
  const productos = await db.producto.findMany({
    where: { id: { in: productoIds } },
    include: { insumo: { include: { grupo: true } }, unidadStock: true },
  });

  const seccionIds = Array.from(new Set(filas.map((f) => f.seccionId)));
  const secciones = await db.seccion.findMany({ where: { id: { in: seccionIds } } });

  const arbolDeGrupos = await cargarArbolDeGrupos(db);

  return armarStockPorFamilia(
    filas.map((f) => ({ productoId: f.productoId, seccionId: f.seccionId, saldo: Number(f._sum.cantidad ?? 0) })),
    productos,
    secciones,
    arbolDeGrupos,
  );
}
