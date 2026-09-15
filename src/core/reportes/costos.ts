import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { construirIndiceRecetas, construirMapaProductos, obtenerCostoActualPorMP, type Db } from "./comun";

export type EstadoCosto = "MARGEN_NEGATIVO" | "FOOD_COST_ALTO" | "COSTO_INCOMPLETO" | "SIN_PRECIO_VENTA" | "SIN_RECETA" | "OK";

export interface ComponenteCosto {
  insumoProductoId: string;
  insumoNombre: string;
  cantidad: number;
  mermaPorcentaje: number;
  unidadNombre: string;
  costoUnitario: number | null;
  costoLinea: number | null;
  proveedorNombre: string | null;
  sinPrecio: boolean;
}

export interface FilaCostoProducto {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  insumoNombre: string | null;
  precioVenta: number;
  costo: number | null;
  margen: number | null;
  margenPct: number | null;
  foodCostPct: number | null;
  costoIncompleto: boolean;
  componentes: ComponenteCosto[];
  estado: EstadoCosto;
}

const ORDEN_ESTADO: Record<EstadoCosto, number> = {
  MARGEN_NEGATIVO: 0,
  FOOD_COST_ALTO: 1,
  COSTO_INCOMPLETO: 2,
  SIN_PRECIO_VENTA: 3,
  SIN_RECETA: 4,
  OK: 5,
};

/**
 * Port de calcularCostosYMargenes_ (Reportes.js:1710-1787). Sesión
 * "eliminar COMPRA+VENTA": lo único vendible es un PV — un producto que
 * "compra y revende tal cual" tiene una receta 1:1 hacia la MP que
 * consume, así que cae en la rama normal, sin necesitar una rama aparte.
 *
 * DECISIÓN (a propósito, no oculta): si falta el precio de algún insumo de
 * la receta, el costo de ESE plato queda `costoIncompleto` y no se inventa
 * un margen parcial — mostrar un número que parece real pero está calculado
 * sobre menos ingredientes de los que hay sería peor que no mostrar nada.
 */
export async function calcularCostosYMargenes(sucursalId: string, db: Db = prisma): Promise<FilaCostoProducto[]> {
  const productos = await construirMapaProductos(sucursalId, db);
  const { recetaPorProducto } = await construirIndiceRecetas(db);
  const costos = await obtenerCostoActualPorMP(sucursalId, db);

  const filas: FilaCostoProducto[] = [];

  for (const info of productos.values()) {
    if (info.tipo !== "PV") continue;

    const items = recetaPorProducto.get(info.id) ?? [];
    const tieneReceta = items.length > 0;

    const componentes: ComponenteCosto[] = [];
    let costoTotal = 0;
    let costoIncompleto = false;

    if (tieneReceta) {
      for (const it of items) {
        const c = costos.get(it.insumoProductoId);
        const cantidadConMerma = it.cantidad * (1 + it.mermaPorcentaje / 100);

        if (!c) {
          costoIncompleto = true;
          componentes.push({
            insumoProductoId: it.insumoProductoId,
            insumoNombre: it.insumoNombre,
            cantidad: it.cantidad,
            mermaPorcentaje: it.mermaPorcentaje,
            unidadNombre: it.unidadNombre,
            costoUnitario: null,
            costoLinea: null,
            proveedorNombre: null,
            sinPrecio: true,
          });
          continue;
        }

        const costoLinea = cantidadConMerma * c.precioPorUnidadStock;
        costoTotal += costoLinea;
        componentes.push({
          insumoProductoId: it.insumoProductoId,
          insumoNombre: it.insumoNombre,
          cantidad: it.cantidad,
          mermaPorcentaje: it.mermaPorcentaje,
          unidadNombre: it.unidadNombre,
          costoUnitario: redondearMoneda(c.precioPorUnidadStock),
          costoLinea: redondearMoneda(costoLinea),
          proveedorNombre: c.proveedorNombre,
          sinPrecio: false,
        });
      }
    } else {
      costoIncompleto = true; // PV sin receta: no hay de dónde sacar el costo
    }

    const precioVenta = info.precioVenta;
    const conocido = !costoIncompleto && costoTotal > 0;
    const margen = conocido && precioVenta > 0 ? precioVenta - costoTotal : null;

    let estado: EstadoCosto;
    if (!precioVenta) estado = "SIN_PRECIO_VENTA";
    else if (!tieneReceta) estado = "SIN_RECETA";
    else if (costoIncompleto) estado = "COSTO_INCOMPLETO";
    else if (margen !== null && margen < 0) estado = "MARGEN_NEGATIVO";
    else if (margen !== null && costoTotal / precioVenta > 0.4) estado = "FOOD_COST_ALTO";
    else estado = "OK";

    filas.push({
      productoId: info.id,
      productoCodigo: info.codigo,
      productoNombre: info.nombre,
      insumoNombre: info.insumoNombre,
      precioVenta,
      costo: conocido ? redondearMoneda(costoTotal) : null,
      margen: margen === null ? null : redondearMoneda(margen),
      margenPct: margen !== null && precioVenta > 0 ? Math.round((margen / precioVenta) * 1000) / 10 : null,
      foodCostPct: conocido && precioVenta > 0 ? Math.round((costoTotal / precioVenta) * 1000) / 10 : null,
      costoIncompleto,
      componentes,
      estado,
    });
  }

  return filas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.productoNombre.localeCompare(b.productoNombre));
}

export interface FilaImpactoInsumo {
  insumoProductoId: string;
  insumoNombre: string;
  platos: string[];
  cantidadPlatos: number;
  costoAcumulado: number;
  costoUnitario: number | null;
  proveedorNombre: string | null;
}

/**
 * Port de calcularImpactoInsumos_ (Reportes.js:1799-1818) — qué insumos
 * mueven más la aguja del costo total: si una MP aparece en muchos platos y
 * pesa mucho, un aumento suyo pega fuerte.
 */
export async function calcularImpactoInsumos(sucursalId: string, db: Db = prisma): Promise<FilaImpactoInsumo[]> {
  const filas = await calcularCostosYMargenes(sucursalId, db);
  const porMP = new Map<string, { insumoNombre: string; platos: Set<string>; costoAcumulado: number; costoUnitario: number | null; proveedorNombre: string | null }>();

  for (const f of filas) {
    for (const c of f.componentes) {
      if (c.sinPrecio || c.costoLinea === null) continue;
      if (!porMP.has(c.insumoProductoId)) {
        porMP.set(c.insumoProductoId, { insumoNombre: c.insumoNombre, platos: new Set(), costoAcumulado: 0, costoUnitario: c.costoUnitario, proveedorNombre: c.proveedorNombre });
      }
      const g = porMP.get(c.insumoProductoId)!;
      g.platos.add(f.productoNombre);
      g.costoAcumulado += c.costoLinea;
    }
  }

  return Array.from(porMP.entries())
    .map(([insumoProductoId, g]) => ({
      insumoProductoId,
      insumoNombre: g.insumoNombre,
      platos: Array.from(g.platos),
      cantidadPlatos: g.platos.size,
      costoAcumulado: redondearMoneda(g.costoAcumulado),
      costoUnitario: g.costoUnitario,
      proveedorNombre: g.proveedorNombre,
    }))
    .sort((a, b) => b.costoAcumulado - a.costoAcumulado);
}
