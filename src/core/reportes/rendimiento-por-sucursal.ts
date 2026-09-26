import type { Db } from "./comun";
import { rendimientoEfectivo } from "@/core/catalogo/rendimiento-local";
import { calcularCantidadTeoricaBruta, calcularDesviacionPorcentaje, desvioEsNotable } from "./rendimiento-recetas-vistas";

/**
 * D8 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): comparación del rendimiento calibrado de cada línea de
 * receta, lado a lado entre varias sucursales. Armado puro, SIN importar el VALOR `@/lib/db` (a propósito — `db` es
 * obligatorio, no opcional, y el import de `Db` de acá arriba es solo de TIPO — se borra al compilar, ver
 * `import type`): a diferencia del resto de `core/reportes`, esta pantalla siempre recibe explícitamente las sucursales
 * de `ctx.membresias`, nunca "la sucursal activa" sola.
 */

export interface ValorPorSucursal {
  /** NETO efectivo (rendimientoEfectivo). */
  cantidad: number;
  mermaPorcentaje: number;
  /** BRUTO = cantidad × (1 + merma/100) — la métrica que se COMPARA entre sucursales (D8: comparar solo el neto engaña si dos sucursales calibraron mermas distintas). */
  bruto: number;
  calibrado: boolean;
  /** % de desvío del bruto de ESTA sucursal contra el bruto CENTRAL — decide el ámbar (desvioEsNotable). `null` si el central es 0. */
  desviacionPorcentaje: number | null;
}

export interface FilaComparacionRendimiento {
  productoId: string;
  productoNombre: string;
  recetaIngredienteId: string;
  insumoProductoId: string;
  insumoNombre: string;
  unidadNombre: string;
  central: { cantidad: number; mermaPorcentaje: number; bruto: number };
  /** Una entrada por sucursal pedida. */
  porSucursal: Map<string, ValorPorSucursal>;
  /** true si ALGUNA sucursal calibró esta línea — filtro por defecto de la pantalla (D8). */
  algunaCalibrada: boolean;
}

export interface FiltroComparacionRendimiento {
  productoId?: string;
  /** false (default de la pantalla): solo líneas con alguna calibración visible. true (`?todas=1`): todas. */
  todas?: boolean;
}

/** Una sola consulta (`recetaVersion.findMany`, con el `include` anidado de `rendimientosLocales`) — sin `@/lib/db`: `db` no tiene default, lo pasa quien llama (siempre `prisma` real en la página). */
export async function compararRendimientosPorSucursal(
  sucursales: readonly { id: string; nombre: string }[],
  filtro: FiltroComparacionRendimiento,
  db: Db
): Promise<FilaComparacionRendimiento[]> {
  const sucursalIds = sucursales.map((s) => s.id);
  const versiones = await db.recetaVersion.findMany({
    where: filtro.productoId ? { productoId: filtro.productoId } : undefined,
    orderBy: { version: "asc" },
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

  // Vigente = la de mayor `version` por producto — `versiones` viene ascendente, así que la última escritura del Map gana.
  const vigentePorProducto = new Map<string, (typeof versiones)[number]>();
  for (const v of versiones) vigentePorProducto.set(v.productoId, v);

  const filas: FilaComparacionRendimiento[] = [];
  for (const v of vigentePorProducto.values()) {
    for (const ing of v.ingredientes) {
      const central = { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje) };
      const centralBruto = calcularCantidadTeoricaBruta(central.cantidad, central.mermaPorcentaje);

      const porSucursal = new Map<string, ValorPorSucursal>();
      let algunaCalibrada = false;
      for (const s of sucursales) {
        const ef = rendimientoEfectivo(
          central,
          ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
          s.id
        );
        if (ef.calibrado) algunaCalibrada = true;
        const bruto = calcularCantidadTeoricaBruta(ef.cantidad, ef.mermaPorcentaje);
        porSucursal.set(s.id, {
          cantidad: ef.cantidad,
          mermaPorcentaje: ef.mermaPorcentaje,
          bruto,
          calibrado: ef.calibrado,
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

export { desvioEsNotable };
