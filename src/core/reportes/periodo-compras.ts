import { redondearMoneda } from "@/core/moneda";
import type { InfoProductoReporte } from "./comun";
import type { ItemPeriodo } from "./periodo-tipos";

export interface FilaCompraPorProveedorProducto {
  nombre: string;
  importe: number;
}
export interface FilaCompraPorProveedor {
  /** Id del proveedor; null = las compras cargadas sin proveedor. */
  proveedorId: string | null;
  proveedor: string;
  importe: number;
  /** Productos DISTINTOS comprados a este proveedor en el rango — antes era "líneas" (renglones de MovimientoStock), que confundía dos renglones del mismo producto en una misma factura con dos productos distintos. */
  cantidadProductos: number;
  /** Compras (operaciones) DISTINTAS hechas a este proveedor en el rango — antes no se distinguía de "líneas". */
  cantidadCompras: number;
  productos: FilaCompraPorProveedorProducto[];
}
export interface ComprasDelPeriodo {
  totalGastado: number;
  /** Parte de `totalGastado` que es packaging, limpieza y demás «No comestibles» (ver core/catalogo/no-comestibles.ts). */
  totalNoComestibles: number;
  porProveedor: FilaCompraPorProveedor[];
  hayComprasSinPrecio: boolean;
  aviso: string;
}

/**
 * Port de calcularComprasDelPeriodo_ (Reportes.js:128-169). A diferencia de
 * Ventas no hace falta un fallback "estimado": el Precio Total de una línea
 * de Compra siempre es el importe real de esa factura puntual (o 0 si se
 * cargó sin precio — campo opcional).
 */
export function calcularComprasDelPeriodo(items: ItemPeriodo[], productos: Map<string, InfoProductoReporte>): ComprasDelPeriodo {
  const porProveedor = new Map<string, { proveedorId: string | null; importe: number; operaciones: Set<string>; productos: Map<string, number> }>();
  let totalGastado = 0;
  let totalNoComestibles = 0;
  let hayComprasSinPrecio = false;

  for (const r of items) {
    if (r.proceso !== "COMPRA" || r.anulada) continue;
    const proveedor = r.proveedorNombre || "Sin proveedor";
    const importe = r.precioTotal;
    if (importe <= 0) hayComprasSinPrecio = true;
    totalGastado += importe;
    if (productos.get(r.productoId)?.esNoComestible) totalNoComestibles += importe;

    if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, { proveedorId: r.proveedorId, importe: 0, operaciones: new Set(), productos: new Map() });
    const acc = porProveedor.get(proveedor)!;
    acc.importe += importe;
    acc.operaciones.add(r.idOperacion);
    acc.productos.set(r.productoNombre, (acc.productos.get(r.productoNombre) ?? 0) + importe);
  }

  const porProveedorLista = Array.from(porProveedor.entries())
    .map(([proveedor, v]) => ({
      proveedorId: v.proveedorId,
      proveedor,
      importe: redondearMoneda(v.importe),
      cantidadCompras: v.operaciones.size,
      cantidadProductos: v.productos.size,
      productos: Array.from(v.productos.entries())
        .map(([nombre, importe]) => ({ nombre, importe: redondearMoneda(importe) }))
        .sort((a, b) => b.importe - a.importe),
    }))
    .sort((a, b) => b.importe - a.importe);

  return {
    totalGastado: redondearMoneda(totalGastado),
    totalNoComestibles: redondearMoneda(totalNoComestibles),
    porProveedor: porProveedorLista,
    hayComprasSinPrecio,
    aviso: hayComprasSinPrecio
      ? "Incluye compras cargadas sin Precio Total (el campo es opcional): esas suman $0 al total gastado."
      : "Importe real de cada compra (Precio Total cargado al registrarla).",
  };
}

export interface FilaGastoPorInsumo {
  insumo: string;
  grupo: string | null;
  importe: number;
  /** % de este insumo sobre el total gastado en Compras del período. */
  porcentaje: number;
  /** % acumulado hasta esta fila (la lista ya viene ordenada de mayor a menor importe) — para el corte 80/20: dónde el acumulado cruza 80% son los insumos que de verdad importan (segunda pasada del grounding, docs/grounding-reportes-compras-2026-09-18.md §5). */
  porcentajeAcumulado: number;
  /** Está entre los insumos que, de mayor a menor gasto, concentran el 80 % del total (regla 80/20). */
  dentroDel80: boolean;
  /** Cantidad de líneas de compra de este insumo (frecuencia de reposición — a diferencia de "líneas" por proveedor, acá sí es una señal útil: reponer seguido un mismo insumo a varios proveedores distintos sugiere consolidar). */
  cantidadCompras: number;
  proveedores: string[];
}
export interface FilaGastoPorGrupo {
  grupo: string;
  importe: number;
}
export interface GastoPorInsumoDelPeriodo {
  porInsumo: FilaGastoPorInsumo[];
  porGrupo: FilaGastoPorGrupo[];
}

/**
 * "¿En qué se me va la plata?" — agrupa el mismo gasto de Compras por
 * INSUMO (y por Grupo/familia), no por proveedor. Hallazgo de grounding
 * (docs/grounding-reportes-compras-2026-09-18.md, paso 1, inspirado en el
 * reporte "Spendings" de Grocy): agrupar solo por proveedor responde una
 * pregunta contable ("cuánto le debo a X"), no la pregunta de gestión
 * real. Reusa `construirMapaProductos` (ya resuelve Insumo/Grupo por
 * producto) en vez de duplicar esa resolución acá.
 */
export function calcularGastoPorInsumoDelPeriodo(items: ItemPeriodo[], productos: Map<string, InfoProductoReporte>): GastoPorInsumoDelPeriodo {
  const porInsumo = new Map<string, { grupo: string | null; importe: number; cantidadCompras: number; proveedores: Set<string> }>();
  const porGrupo = new Map<string, number>();

  for (const r of items) {
    if (r.proceso !== "COMPRA" || r.anulada) continue;
    const info = productos.get(r.productoId);
    const insumo = info?.insumoNombre ?? "Sin insumo asignado";
    const grupo = info?.grupoNombre ?? null;
    const importe = r.precioTotal;

    if (!porInsumo.has(insumo)) porInsumo.set(insumo, { grupo, importe: 0, cantidadCompras: 0, proveedores: new Set() });
    const acc = porInsumo.get(insumo)!;
    acc.importe += importe;
    acc.cantidadCompras += 1;
    if (r.proveedorNombre) acc.proveedores.add(r.proveedorNombre);

    const claveGrupo = grupo ?? "Sin categoría";
    porGrupo.set(claveGrupo, (porGrupo.get(claveGrupo) ?? 0) + importe);
  }

  const totalGastadoInsumos = Array.from(porInsumo.values()).reduce((acc, v) => acc + v.importe, 0);
  let acumulado = 0;
  const porInsumoLista = Array.from(porInsumo.entries())
    .map(([insumo, v]) => ({ insumo, grupo: v.grupo, importe: v.importe, cantidadCompras: v.cantidadCompras, proveedores: Array.from(v.proveedores).sort() }))
    .sort((a, b) => b.importe - a.importe)
    .map((f) => {
      acumulado += f.importe;
      return {
        ...f,
        importe: redondearMoneda(f.importe),
        porcentaje: totalGastadoInsumos > 0 ? Math.round((f.importe / totalGastadoInsumos) * 1000) / 10 : 0,
        porcentajeAcumulado: totalGastadoInsumos > 0 ? Math.round((acumulado / totalGastadoInsumos) * 1000) / 10 : 0,
        dentroDel80: false,
      };
    });
  // Corte Pareto 80/20: los insumos, de mayor a menor gasto, hasta el primero donde el acumulado llega al 80 % (ese incluido).
  const corte80 = porInsumoLista.findIndex((f) => f.porcentajeAcumulado >= 80);
  if (corte80 >= 0) for (let i = 0; i <= corte80; i++) porInsumoLista[i].dentroDel80 = true;

  const porGrupoLista = Array.from(porGrupo.entries())
    .map(([grupo, importe]) => ({ grupo, importe: redondearMoneda(importe) }))
    .sort((a, b) => b.importe - a.importe);

  return { porInsumo: porInsumoLista, porGrupo: porGrupoLista };
}
