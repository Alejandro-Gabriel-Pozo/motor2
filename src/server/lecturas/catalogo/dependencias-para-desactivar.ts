import "server-only";
import { alcanceDeSucursal, whereDisponibleEn } from "@/core/catalogo/public";
import { cargarRecetasVigentes } from "@/server/lecturas/catalogo/recetas-vigentes";
import type { Db } from "@/lib/db-tipos";

export interface DependenciasDeProducto {
  /** Platos cuya receta VIGENTE usa el producto y que están disponibles EN ESTA SUCURSAL, por nombre. */
  recetasVigentes: { productoId: string; nombre: string }[];
  /** Secciones DE ESTA SUCURSAL donde el producto tiene saldo distinto de cero. */
  saldos: { sucursalNombre: string; seccionNombre: string; saldo: number }[];
}

/**
 * Qué depende de un producto antes de darlo de baja EN UNA SUCURSAL (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.2).
 * Desactivarlo ahí lo saca de los selectores de movimiento, de Stock consolidado y de la Valuación DE ESA SUCURSAL; y si es una
 * MP de la receta vigente de un plato disponible ahí, ese plato deja de poder venderse ahí. Por eso se cuentan dos cosas, LAS
 * DOS acotadas a `sucursalId` — saldo en OTRA sucursal no bloquea, saldo en ESTA sí:
 *
 * - recetas VIGENTES (la EFECTIVA de esta sucursal de cada plato, el mismo criterio que usa la venta: su receta propia si la tiene habilitada, si no la central) de platos DISPONIBLES EN ESTA
 *   SUCURSAL (`whereDisponibleEn`, no ya "activos" — un plato que solo existe en otra sucursal no se puede vender acá, así que
 *   no bloquea acá). Una versión vieja no se puede vender, así que no bloquea nada.
 * - saldo por sección, de ESTA sucursal únicamente. Se agrupa por sección y se ignoran las que suman cero (un +5 y un −5 en la
 *   misma sección no es saldo), pero no se netea entre secciones distintas.
 */
export async function dependenciasParaDesactivar(productoId: string, sucursalId: string, db: Db): Promise<DependenciasDeProducto> {
  const usos = await db.recetaIngrediente.findMany({
    where: { insumoProductoId: productoId, recetaVersion: { producto: whereDisponibleEn(sucursalId) } },
    select: { recetaVersion: { select: { id: true, productoId: true, producto: { select: { nombre: true } } } } },
  });
  const platos = [...new Set(usos.map((u) => u.recetaVersion.productoId))];
  const vigentes = await cargarRecetasVigentes(db, alcanceDeSucursal(sucursalId), { where: { productoId: { in: platos } }, include: {} });
  const recetasVigentes = new Map<string, string>();
  for (const { recetaVersion } of usos) {
    if (recetaVersion.id === vigentes.get(recetaVersion.productoId)?.id) recetasVigentes.set(recetaVersion.productoId, recetaVersion.producto.nombre);
  }

  const porSeccion = await db.movimientoStock.groupBy({ by: ["seccionId"], where: { productoId, seccion: { sucursalId } }, _sum: { cantidad: true } });
  const conSaldo = porSeccion.filter((s) => s._sum.cantidad !== null && !s._sum.cantidad.isZero());
  const secciones = conSaldo.length
    ? await db.seccion.findMany({ where: { id: { in: conSaldo.map((s) => s.seccionId) } }, select: { id: true, nombre: true, sucursal: { select: { nombre: true } } } })
    : [];
  const datosDeSeccion = new Map(secciones.map((s) => [s.id, s]));
  const saldos = conSaldo
    .map((s) => ({
      sucursalNombre: datosDeSeccion.get(s.seccionId)?.sucursal.nombre ?? "?",
      seccionNombre: datosDeSeccion.get(s.seccionId)?.nombre ?? "?",
      saldo: Number(s._sum.cantidad),
    }))
    .sort((a, b) => a.sucursalNombre.localeCompare(b.sucursalNombre) || a.seccionNombre.localeCompare(b.seccionNombre));

  return {
    recetasVigentes: [...recetasVigentes].map(([id, nombre]) => ({ productoId: id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    saldos,
  };
}
