import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import {
  construirIndiceRecetas,
  construirMapaProductos,
  obtenerCostoActualPorMP,
  type CostoMP,
  type Db,
  type IngredienteRecetaReporte,
  type InfoProductoReporte,
} from "./comun";

export type EstadoCosto = "MARGEN_NEGATIVO" | "FOOD_COST_ALTO" | "COSTO_INCOMPLETO" | "SIN_PRECIO_VENTA" | "SIN_RECETA" | "OK";

interface CostoResuelto {
  costoUnitario: number;
  proveedorNombre: string | null;
}

/**
 * Costo unitario de UN insumo de receta — recursivo para MP "Se produce"
 * (ej. la prepizza: nunca se compra, se fabrica con SU PROPIA receta de
 * harina/levadura/sal/aceite). Sin esto, cualquier plato que use un
 * intermedio fabricado quedaba SIEMPRE en COSTO_INCOMPLETO — no importaba
 * qué tan completos estuvieran los datos, `obtenerCostoActualPorMP` nunca
 * iba a encontrar una compra de algo que por diseño no se compra.
 *
 * `cache` memoiza por producto (mismo intermedio puede aparecer en varias
 * recetas); `enCurso` corta un ciclo de recetas (A usa B, B usa A) en vez
 * de colgarse — no debería pasar nunca en datos reales, es una barrera de
 * seguridad, no un caso esperado.
 */
function resolverCostoUnitario(
  productoId: string,
  productos: Map<string, InfoProductoReporte>,
  recetaPorProducto: Map<string, IngredienteRecetaReporte[]>,
  costosCompra: Map<string, CostoMP>,
  cache: Map<string, CostoResuelto | null>,
  enCurso: Set<string>
): CostoResuelto | null {
  if (cache.has(productoId)) return cache.get(productoId) ?? null;
  if (enCurso.has(productoId)) return null;

  const info = productos.get(productoId);
  if (!info?.seProduce) {
    const c = costosCompra.get(productoId);
    const resultado = c ? { costoUnitario: c.precioPorUnidadStock, proveedorNombre: c.proveedorNombre } : null;
    cache.set(productoId, resultado);
    return resultado;
  }

  enCurso.add(productoId);
  const items = recetaPorProducto.get(productoId) ?? [];
  let total = 0;
  let completo = items.length > 0;
  for (const it of items) {
    const sub = resolverCostoUnitario(it.insumoProductoId, productos, recetaPorProducto, costosCompra, cache, enCurso);
    if (!sub) {
      completo = false;
      break;
    }
    total += it.cantidad * (1 + it.mermaPorcentaje / 100) * sub.costoUnitario;
  }
  enCurso.delete(productoId);

  // Fabricado acá adentro — no tiene "proveedor" propio, el costo sale de
  // explotar su receta.
  const resultado = completo ? { costoUnitario: total, proveedorNombre: null } : null;
  cache.set(productoId, resultado);
  return resultado;
}

export interface ComponenteCosto {
  insumoProductoId: string;
  insumoNombre: string;
  /** Para el link accionable de "costo incompleto": un MP "Se produce" no se compra, se arregla cargando/completando SU receta — no tiene sentido mandarlo a Compra. */
  insumoSeProduce: boolean;
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
  // Compartido entre todos los PV de este cálculo: un mismo intermedio
  // fabricado (ej. la prepizza) suele aparecer en varias recetas — no hace
  // falta re-explotar su BOM cada vez.
  const cacheCostoIntermedios = new Map<string, CostoResuelto | null>();

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
        const infoInsumo = productos.get(it.insumoProductoId);
        const c = resolverCostoUnitario(it.insumoProductoId, productos, recetaPorProducto, costos, cacheCostoIntermedios, new Set());
        const cantidadConMerma = it.cantidad * (1 + it.mermaPorcentaje / 100);

        if (!c) {
          costoIncompleto = true;
          componentes.push({
            insumoProductoId: it.insumoProductoId,
            insumoNombre: it.insumoNombre,
            insumoSeProduce: infoInsumo?.seProduce ?? false,
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

        const costoLinea = cantidadConMerma * c.costoUnitario;
        costoTotal += costoLinea;
        componentes.push({
          insumoProductoId: it.insumoProductoId,
          insumoNombre: it.insumoNombre,
          insumoSeProduce: infoInsumo?.seProduce ?? false,
          cantidad: it.cantidad,
          mermaPorcentaje: it.mermaPorcentaje,
          unidadNombre: it.unidadNombre,
          costoUnitario: redondearMoneda(c.costoUnitario),
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

/** Costo completo de la receta de UN plato — misma recursión que `calcularCostosYMargenes`, pero solo el total (sin armar `componentes`) y con un cache propio por llamada: `costosCompra` cambia entre "antes" y "ahora", así que el cache de una corrida no puede reusarse en la otra. */
export function resolverCostoRecetaCompleta(
  productoId: string,
  productos: Map<string, InfoProductoReporte>,
  recetaPorProducto: Map<string, IngredienteRecetaReporte[]>,
  costosCompra: Map<string, CostoMP>
): number | null {
  const items = recetaPorProducto.get(productoId) ?? [];
  if (!items.length) return null;

  const cache = new Map<string, CostoResuelto | null>();
  let total = 0;
  for (const it of items) {
    const c = resolverCostoUnitario(it.insumoProductoId, productos, recetaPorProducto, costosCompra, cache, new Set());
    if (!c) return null;
    total += it.cantidad * (1 + it.mermaPorcentaje / 100) * c.costoUnitario;
  }
  return total;
}

export interface FilaImpactoRecetaPorPeriodo {
  productoId: string;
  productoNombre: string;
  precioVenta: number;
  costoAntes: number;
  costoActual: number;
  deltaCosto: number;
  foodCostPctAntes: number | null;
  foodCostPctActual: number | null;
}

/**
 * "¿A qué platos les pega el cambio de precio de este período, y cuánto?"
 * — paso 4 del grounding (segunda pasada, docs/grounding-reportes-
 * compras-2026-09-18.md §5): la diferencia real entre software de
 * gastronomía y un ERP genérico es vincular compra -> receta -> plato,
 * algo que ninguna de las referencias de la primera pasada (ERPNext/
 * Dolibarr/Grocy) puede sugerir porque ninguna modela recetas.
 *
 * Recalcula el costo de CADA receta dos veces — con el costo de reposición
 * de HOY (`obtenerCostoActualPorMP`, el mismo "más reciente" que ya usa
 * `calcularCostosYMargenes` en todos lados) y con el que regía justo antes
 * de `desde` (mismo método, `antesDe`) — y se queda solo con los platos
 * donde el resultado cambió de verdad. Al reusar `resolverCostoUnitario`
 * (recursivo) para las dos corridas, un aumento en un intermedio "se
 * produce" (ej. la prepizza) se propaga solo, sin necesitar mapear a mano
 * qué plato usa qué intermedio.
 *
 * Un producto sin ninguna compra ANTES de `desde` (primera vez que se
 * compra) no tiene con qué comparar — `costosParaAntes` cae al costo
 * ACTUAL para ese producto puntual (no introduce una diferencia donde no
 * hay dato, mismo criterio que el delta `null` de `calcularTendenciaPreciosDelPeriodo`).
 */
export async function calcularImpactoRecetasPorPeriodo(sucursalId: string, desde: Date, db: Db = prisma): Promise<FilaImpactoRecetaPorPeriodo[]> {
  const productos = await construirMapaProductos(sucursalId, db);
  const { recetaPorProducto } = await construirIndiceRecetas(db);
  const costosActuales = await obtenerCostoActualPorMP(sucursalId, db);
  const costosAntesDelPeriodo = await obtenerCostoActualPorMP(sucursalId, db, desde);

  const costosParaAntes = new Map(costosActuales);
  for (const [productoId, c] of costosAntesDelPeriodo) costosParaAntes.set(productoId, c);

  const filas: FilaImpactoRecetaPorPeriodo[] = [];
  for (const info of productos.values()) {
    if (info.tipo !== "PV") continue;

    const costoActual = resolverCostoRecetaCompleta(info.id, productos, recetaPorProducto, costosActuales);
    const costoAntes = resolverCostoRecetaCompleta(info.id, productos, recetaPorProducto, costosParaAntes);
    if (costoActual === null || costoAntes === null) continue; // costo incompleto en alguna de las dos corridas — no se puede comparar
    if (Math.abs(costoActual - costoAntes) < 0.005) continue; // sin cambio real

    filas.push({
      productoId: info.id,
      productoNombre: info.nombre,
      precioVenta: info.precioVenta,
      costoAntes: redondearMoneda(costoAntes),
      costoActual: redondearMoneda(costoActual),
      deltaCosto: redondearMoneda(costoActual - costoAntes),
      foodCostPctAntes: info.precioVenta > 0 ? Math.round((costoAntes / info.precioVenta) * 1000) / 10 : null,
      foodCostPctActual: info.precioVenta > 0 ? Math.round((costoActual / info.precioVenta) * 1000) / 10 : null,
    });
  }

  return filas.sort((a, b) => Math.abs(b.deltaCosto) - Math.abs(a.deltaCosto));
}
