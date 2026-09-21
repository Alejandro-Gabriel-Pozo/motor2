import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface DependenciasDeProducto {
  /** Platos ACTIVOS cuya receta VIGENTE usa el producto, por nombre. */
  recetasVigentes: { productoId: string; nombre: string }[];
  /** Secciones (de cualquier sucursal) donde el producto tiene saldo distinto de cero. */
  saldos: { sucursalNombre: string; seccionNombre: string; saldo: number }[];
}

/**
 * Qué depende de un producto antes de darlo de baja. Desactivarlo lo saca de los selectores de movimiento, de Stock consolidado y de la Valuación; y si es una
 * MP de la receta vigente de un plato activo, ese plato deja de poder venderse («La materia prima de la receta … no está marcada como MP activa»). Por eso
 * se cuentan dos cosas:
 *
 * - recetas VIGENTES (la de mayor versión de cada plato, el mismo criterio que usa la venta) de platos ACTIVOS. Una versión vieja o un plato inactivo no
 *   se pueden vender, así que no bloquean nada.
 * - saldo por sección, de TODAS las sucursales: el producto es global, y darlo de baja lo saca del stock de todas. Se agrupa por sección y se ignoran las que
 *   suman cero (un +5 y un −5 en la misma sección no es saldo), pero no se netea entre secciones distintas.
 */
export async function dependenciasParaDesactivar(productoId: string, db: PrismaClient = prisma): Promise<DependenciasDeProducto> {
  const usos = await db.recetaIngrediente.findMany({
    where: { insumoProductoId: productoId, recetaVersion: { producto: { activo: true } } },
    select: { recetaVersion: { select: { productoId: true, version: true, producto: { select: { nombre: true } } } } },
  });
  const platos = [...new Set(usos.map((u) => u.recetaVersion.productoId))];
  const vigentes = platos.length
    ? await db.recetaVersion.groupBy({ by: ["productoId"], where: { productoId: { in: platos } }, _max: { version: true } })
    : [];
  const versionVigente = new Map(vigentes.map((v) => [v.productoId, v._max.version]));
  const recetasVigentes = new Map<string, string>();
  for (const { recetaVersion } of usos) {
    if (recetaVersion.version === versionVigente.get(recetaVersion.productoId)) recetasVigentes.set(recetaVersion.productoId, recetaVersion.producto.nombre);
  }

  const porSeccion = await db.movimientoStock.groupBy({ by: ["seccionId"], where: { productoId }, _sum: { cantidad: true } });
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
