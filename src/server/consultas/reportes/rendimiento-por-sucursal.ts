import "server-only";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { ALCANCE_CENTRAL, cargarRecetasPropiasHabilitadas, cargarRecetasVigentes } from "@/core/catalogo/public-servidor";
import { calcularCantidadTeoricaBruta, calcularDesviacionPorcentaje } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";
import type { ValorPorSucursal, FilaComparacionRendimiento, FiltroComparacionRendimiento } from "@/core/reportes/public";

/** Una sola consulta (`cargarRecetasVigentes`, con el `include` anidado de `rendimientosLocales`) — sin `@/lib/db`: `db` no tiene default, lo pasa quien llama (siempre `prisma` real en la página). */
export async function compararRendimientosPorSucursal(
  sucursales: readonly { id: string; nombre: string }[],
  filtro: FiltroComparacionRendimiento,
  db: Db
): Promise<FilaComparacionRendimiento[]> {
  const sucursalIds = sucursales.map((s) => s.id);
  // Compara las calibraciones de las líneas de la receta CENTRAL: lee la estructura central y, de cada sucursal, solo si tiene receta propia (ahí la línea central no rige).
  const vigentePorProducto = await cargarRecetasVigentes(db, ALCANCE_CENTRAL, {
    where: filtro.productoId ? { productoId: filtro.productoId } : undefined,
    include: {
      producto: { select: { nombre: true } },
      ingredientes: {
        include: {
          insumoProducto: { select: { nombre: true } },
          unidad: { select: { nombre: true } },
          rendimientosLocales: { where: { sucursalId: { in: sucursalIds } } },
        },
      },
    },
  });

  const conRecetaPropia = await cargarRecetasPropiasHabilitadas(db, sucursalIds, [...vigentePorProducto.keys()]);

  const filas: FilaComparacionRendimiento[] = [];
  for (const v of vigentePorProducto.values()) {
    for (const ing of v.ingredientes) {
      const central = { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje) };
      const centralBruto = calcularCantidadTeoricaBruta(central.cantidad, central.mermaPorcentaje);

      const porSucursal = new Map<string, ValorPorSucursal>();
      let algunaCalibrada = false;
      for (const s of sucursales) {
        const recetaPropia = conRecetaPropia.has(`${s.id}:${v.productoId}`);
        const ef = rendimientoEfectivo(
          central,
          ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
          recetaPropia ? "" : s.id
        );
        if (ef.calibrado) algunaCalibrada = true;
        const bruto = calcularCantidadTeoricaBruta(ef.cantidad, ef.mermaPorcentaje);
        porSucursal.set(s.id, {
          cantidad: ef.cantidad,
          mermaPorcentaje: ef.mermaPorcentaje,
          bruto,
          calibrado: ef.calibrado,
          recetaPropia,
          desviacionPorcentaje: calcularDesviacionPorcentaje(bruto, centralBruto),
        });
      }

      if (!filtro.todas && !algunaCalibrada) continue;

      filas.push({
        productoId: v.productoId,
        productoNombre: v.producto.nombre,
        recetaIngredienteId: ing.id,
        insumoProductoId: ing.insumoProductoId,
        insumoNombre: ing.insumoProducto.nombre,
        unidadNombre: ing.unidad.nombre,
        central: { ...central, bruto: centralBruto },
        porSucursal,
        algunaCalibrada,
      });
    }
  }

  return filas.sort((a, b) => a.productoNombre.localeCompare(b.productoNombre, "es") || a.insumoNombre.localeCompare(b.insumoNombre, "es"));
}

/**
 * Filas de comparación del rendimiento calibrado de cada línea de receta vigente, una columna por sucursal de `sucursales` (siempre las de `ctx.membresias`). Envoltorio
 * fino que existía antes de la Fase 3 (la lectura y el armado ya viven acá, no en `core/reportes`): la página lo llama después de `requierePermisoVer(..., "reporte_rendimiento_sucursal")`.
 */
export async function compararRendimientosDeSucursales(
  sucursales: readonly { id: string; nombre: string }[],
  filtro: FiltroComparacionRendimiento,
  db: Db
): Promise<FilaComparacionRendimiento[]> {
  return compararRendimientosPorSucursal(sucursales, filtro, db);
}
