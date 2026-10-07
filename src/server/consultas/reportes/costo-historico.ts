import { Prisma } from "@prisma/client";
import { type IndiceRecetas, type InfoProductoReporte } from "@/core/reportes/public";
import { resolverCostoRecetaCompleta } from "@/core/reportes/public";
import { asegurarIndiceRecetasDeLaSucursal } from "@/core/reportes/public";
import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import { diaUtc, costosDeInsumosPorDia, claveCostoHistorico } from "@/core/reportes/public";

/**
 * Costo unitario reconstruido de cada (plato, día) pedido. `null` = no se pudo costear (algún insumo sin compras hasta ese día, o
 * el plato sin receta). La clave es `${productoId}|${YYYY-MM-DD}` (ver `claveCostoHistorico`).
 */
export async function reconstruirCostosDeVenta(
  sucursalId: string,
  ventas: { productoId: string; fecha: Date }[],
  db: Db,
  /** El catálogo ya cargado de LA MISMA sucursal, para no volver a leerlo (ver `calcularCostosYMargenes`). */
  productosCargados?: Map<string, InfoProductoReporte>,
  /** El índice de recetas ya cargado, mismo motivo (ver `obtenerReportePorPeriodoConCatalogo`). */
  indiceRecetas?: IndiceRecetas
): Promise<Map<string, number | null>> {
  if (indiceRecetas) asegurarIndiceRecetasDeLaSucursal(indiceRecetas, sucursalId);
  const resultado = new Map<string, number | null>();
  if (!ventas.length) return resultado;

  const dias = ventas.map((v) => diaUtc(v.fecha));
  const primerDia = [...dias].sort()[0];
  const ultimoDia = [...dias].sort().at(-1)!;
  const primerDiaFecha = new Date(`${primerDia}T00:00:00Z`);
  const ultimoDiaFechaExclusiva = new Date(new Date(`${ultimoDia}T00:00:00Z`).getTime() + 86_400_000);

  const [productos, { recetaPorProducto }, comprasEnVentana, semilla] = await Promise.all([
    productosCargados ?? construirMapaProductos(sucursalId, db),
    indiceRecetas ? Promise.resolve(indiceRecetas) : construirIndiceRecetas(db, sucursalId),
    // Solo las compras DENTRO del rango pedido — antes traía toda la historia de compras de la sucursal en cada
    // llamada. Lo anterior a `primerDia` lo cubre la "semilla" de abajo: como todo día pedido es >= `primerDia`,
    // la semilla (la compra más reciente de cada insumo antes de `primerDia`) siempre domina en fecha a cualquier
    // compra pre-ventana que no sea ella misma, así que el resultado es idéntico a traer toda la historia — ver
    // el test "guardián de semántica" en costo-historico.test.ts, que fija esta equivalencia.
    db.movimientoStock.findMany({
      where: {
        proceso: "COMPRA",
        seccion: { sucursalId },
        precioPorUnidadStock: { gt: 0 },
        // Una compra anulada no cuenta para reconstruir el costo de un día (ni acá ni en la semilla de abajo).
        operacion: { fecha: { gte: primerDiaFecha, lt: ultimoDiaFechaExclusiva }, anuladaEn: null },
      },
      select: { productoId: true, precioPorUnidadStock: true, operacion: { select: { fecha: true } } },
    }),
    // La semilla: 1 fila por producto (no por compra), la más reciente estrictamente anterior a `primerDia`.
    // `m."id" DESC` fija el desempate entre dos compras del mismo producto con la misma fecha (antes no
    // determinista: dependía del orden de entrega del `findMany`, sin `orderBy`).
    db.$queryRaw<{ productoId: string; precioPorUnidadStock: Prisma.Decimal; fecha: Date }[]>`
      SELECT DISTINCT ON (m."productoId") m."productoId", m."precioPorUnidadStock", o."fecha"
      FROM "MovimientoStock" m
      JOIN "Operacion" o ON o."id" = m."operacionId"
      JOIN "Seccion" s ON s."id" = m."seccionId"
      WHERE m."proceso" = 'COMPRA' AND s."sucursalId" = ${sucursalId}
        AND m."precioPorUnidadStock" > 0 AND o."fecha" < ${primerDiaFecha} AND o."anuladaEn" IS NULL
      ORDER BY m."productoId", o."fecha" DESC, m."id" DESC
    `,
  ]);

  const compras = [
    ...semilla.map((c) => ({ productoId: c.productoId, fecha: c.fecha, precioPorUnidadStock: Number(c.precioPorUnidadStock) })),
    ...comprasEnVentana.map((c) => ({ productoId: c.productoId, fecha: c.operacion.fecha, precioPorUnidadStock: Number(c.precioPorUnidadStock) })),
  ];
  const costosPorDia = costosDeInsumosPorDia(compras, dias);

  for (const v of ventas) {
    const clave = claveCostoHistorico(v.productoId, diaUtc(v.fecha));
    if (resultado.has(clave)) continue;
    resultado.set(clave, resolverCostoRecetaCompleta(v.productoId, productos, recetaPorProducto, costosPorDia.get(diaUtc(v.fecha)) ?? new Map()));
  }
  return resultado;
}