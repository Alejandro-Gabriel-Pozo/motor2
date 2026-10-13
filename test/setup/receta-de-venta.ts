import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// RECETA (ADR-033, sin receta no se vende) ---------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Le da a un PV de un fixture una RECETA DE REVENTA (ADR-033: desde la regla «sin receta no se vende», un PV se vende solo con receta vigente o stock propio): una materia prima propia
 * («<nombre> (reventa)», misma unidad de stock que el PV, disponible en las sucursales dadas) y la receta CENTRAL versión 1 con UN ingrediente: 1 unidad de esa materia prima por unidad vendida
 * (lo mismo que cargaría el dueño para una gaseosa). Con `stock`, además, una COMPRA de esa materia prima en cada sección dada (fecha 2000-01-01, sin lote, precio `precioPorUnidad`), para
 * que vender no deje stock negativo ni avisos (el POS vende igual, pero audita cada insumo en negativo y lo dice en el mensaje del cierre).
 *
 * Sirve para Vitest y para Playwright: recibe el cliente con el que siembra cada uno (`prisma` de `test/setup/test-db.ts` o de `test/e2e/fixtures/db.ts`; con el dueño y varias empresas activas, la
 * `empresaId` explícita). Devuelve la materia prima.
 */
export async function darRecetaDeReventa(
  db: Db,
  pv: { id: string; nombre: string; codigo: string; unidadStockId: string },
  opciones: { sucursalIds: readonly string[]; empresaId?: string; stock?: { cantidad: number; seccionIds: readonly string[]; usuarioId: string; precioPorUnidad?: number } }
) {
  const e = opciones.empresaId ? { empresaId: opciones.empresaId } : {};
  const mp = await db.producto.create({ data: { ...e, codigo: `MP_REV_${pv.codigo}`, nombre: `${pv.nombre} (reventa)`, tipo: "MP", unidadStockId: pv.unidadStockId } });
  for (const sucursalId of opciones.sucursalIds) await db.disponibilidadProducto.create({ data: { ...e, sucursalId, productoId: mp.id, disponible: true } });
  await db.recetaVersion.create({ data: { ...e, productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: pv.unidadStockId, mermaPorcentaje: 0 }] } } });
  if (opciones.stock) {
    const { cantidad, seccionIds, usuarioId, precioPorUnidad = 0 } = opciones.stock;
    for (const seccionId of seccionIds) {
      const { sucursalId } = await db.seccion.findUniqueOrThrow({ where: { id: seccionId }, select: { sucursalId: true } });
      const operacion = await db.operacion.create({ data: { ...e, sucursalId, proceso: "COMPRA", fecha: new Date("2000-01-01T12:00:00Z"), usuarioId } });
      await db.movimientoStock.create({
        data: { ...e, operacionId: operacion.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad, detalle: "Stock de reventa (fixture)", precioTotal: cantidad * precioPorUnidad, precioPorUnidadStock: precioPorUnidad },
      });
    }
  }
  return mp;
}

/**
 * Deshace lo que sembró `darRecetaDeReventa` (para los specs de Playwright, que limpian lo suyo al terminar): los movimientos de las materias primas de reventa (el stock y lo que consumieron las
 * ventas que el spec todavía no borró), las COMPRA de stock que quedan vacías, las recetas de los PV, la disponibilidad y las materias primas. Va ANTES de borrar los PV (la receta los referencia).
 */
export async function borrarRecetasDeReventa(db: Db, { pvIds, mpIds }: { pvIds: readonly string[]; mpIds: readonly string[] }) {
  const operacionIds = [...new Set((await db.movimientoStock.findMany({ where: { productoId: { in: [...mpIds] } }, select: { operacionId: true } })).map((m) => m.operacionId))];
  await db.movimientoStock.deleteMany({ where: { productoId: { in: [...mpIds] } } });
  await db.operacion.deleteMany({ where: { id: { in: operacionIds }, proceso: "COMPRA", movimientos: { none: {} } } });
  await db.recetaIngrediente.deleteMany({ where: { recetaVersion: { productoId: { in: [...pvIds] } } } });
  await db.recetaVersion.deleteMany({ where: { productoId: { in: [...pvIds] } } });
  await db.disponibilidadProducto.deleteMany({ where: { productoId: { in: [...mpIds] } } });
  await db.producto.deleteMany({ where: { id: { in: [...mpIds] } } });
}
