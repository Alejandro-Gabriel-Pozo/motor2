"use client";

import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { SIN_PROVEEDOR } from "@/core/reportes/compras-filtros";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaMargenProducto, FilaCompraPorProveedor, FilaGastoPorInsumo, FilaPrecioInsumo } from "@/core/reportes/periodo";
import type { FilaImpactoRecetaPorPeriodo } from "@/core/reportes/costos";

const COLUMNAS_VENTAS: ColumnaReporte<FilaMargenProducto>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (v) => v.producto,
    render: (v) => (
      <EnlaceInterno href={`/reportes/historial?productoId=${v.productoId}`} className="underline">
        {v.producto} {v.ingresoEstimado && <span className="text-amber-700 dark:text-amber-600">(estimado)</span>}
      </EnlaceInterno>
    ),
  },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (v) => v.cantidad, render: (v) => v.cantidad },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (v) => v.ingreso, render: (v) => `$${v.ingreso.toLocaleString("es-AR")}` },
  {
    clave: "margen",
    etiqueta: "Margen",
    alinear: "derecha",
    valor: (v) => v.margen,
    render: (v) => {
      if (v.margen !== null) return `$${v.margen.toLocaleString("es-AR")} (${v.margenPct}%)`;
      if (v.accionFaltante) {
        return (
          <EnlaceInterno href={v.accionFaltante.href} className="text-amber-700 dark:text-amber-600 underline">
            {v.accionFaltante.etiqueta}
          </EnlaceInterno>
        );
      }
      return <span className="text-amber-700 dark:text-amber-600">costo incompleto</span>;
    },
  },
];

function columnasCompras(desde?: string, hasta?: string): ColumnaReporte<FilaCompraPorProveedor>[] {
  return [
  {
    clave: "proveedor",
    etiqueta: "Proveedor",
    valor: (p) => p.proveedor,
    // El nombre lleva al listado de compras de ese proveedor en el mismo período (ver qué se compró, con qué factura y cuándo).
    render: (p) => (
      <Link href={`/reportes/compras?proveedorId=${p.proveedorId ?? SIN_PROVEEDOR}${desde ? `&desde=${desde}` : ""}${hasta ? `&hasta=${hasta}` : ""}`} className="underline">
        {p.proveedor}
      </Link>
    ),
  },
  {
    clave: "lineas",
    etiqueta: "Líneas",
    alinear: "derecha",
    valor: (p) => p.lineas,
    render: (p) => p.lineas,
    ayuda: "Cantidad de renglones de compra (no de facturas ni de productos distintos) sumados de todas las compras a este proveedor en el rango de fechas elegido.",
  },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (p) => p.importe, render: (p) => `$${p.importe.toLocaleString("es-AR")}` },
  ];
}

export function TablaVentasPorProducto({ filas }: { filas: FilaMargenProducto[] }) {
  return (
    <TablaReporte columnas={COLUMNAS_VENTAS} filas={filas} claveFila={(v) => v.productoId} sinFilasTexto="Sin ventas en el período." nombreExport="ventas-por-producto" />
  );
}

export function TablaComprasPorProveedor({ filas, desde, hasta }: { filas: FilaCompraPorProveedor[]; desde?: string; hasta?: string }) {
  return (
    <TablaReporte
      columnas={columnasCompras(desde, hasta)}
      filas={filas}
      claveFila={(p) => p.proveedor}
      sinFilasTexto="Sin compras en el período."
      nombreExport="compras-por-proveedor"
    />
  );
}

const COLUMNAS_GASTO_INSUMO: ColumnaReporte<FilaGastoPorInsumo>[] = [
  { clave: "insumo", etiqueta: "Insumo", valor: (f) => f.insumo, render: (f) => f.insumo },
  { clave: "grupo", etiqueta: "Categoría", valor: (f) => f.grupo, render: (f) => f.grupo ?? <span className="text-neutral-400">Sin categoría</span> },
  { clave: "importe", etiqueta: "Gastado", alinear: "derecha", valor: (f) => f.importe, render: (f) => `$${f.importe.toLocaleString("es-AR")}` },
  {
    clave: "porcentaje",
    etiqueta: "% del gasto",
    alinear: "derecha",
    valor: (f) => f.porcentaje,
    render: (f) => `${f.porcentaje}%`,
  },
  {
    clave: "acumulado",
    etiqueta: "% acumulado",
    alinear: "derecha",
    valor: (f) => f.porcentajeAcumulado,
    render: (f) => `${f.porcentajeAcumulado}%`,
    ayuda: "Ordenado de mayor a menor gasto: dónde este acumulado cruza 80% están los insumos que de verdad concentran el gasto (regla 80/20) — lo que sigue después suele ser ruido, no hace falta prestarle la misma atención.",
  },
  {
    clave: "veces",
    etiqueta: "Veces comprado",
    alinear: "derecha",
    valor: (f) => f.cantidadCompras,
    render: (f) => f.cantidadCompras,
    ayuda: "Cantidad de compras registradas de este insumo en el rango — varias compras a proveedores distintos puede ser señal de consolidar.",
  },
  {
    clave: "proveedores",
    etiqueta: "Proveedores",
    valor: (f) => f.proveedores.join(", "),
    render: (f) => (f.proveedores.length ? f.proveedores.join(", ") : <span className="text-neutral-400">—</span>),
  },
];

export function TablaGastoPorInsumo({ filas }: { filas: FilaGastoPorInsumo[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_GASTO_INSUMO}
      filas={filas}
      claveFila={(f) => f.insumo}
      sinFilasTexto="Sin compras en el período."
      nombreExport="gasto-por-insumo"
      ordenInicial="importe"
      direccionInicial="desc"
      claseFila={(f) => (f.dentroDel80 ? "bg-amber-50 dark:bg-amber-950/30" : undefined)}
    />
  );
}

function claseDelta(delta: number | null): string {
  if (delta === null) return "text-neutral-400";
  if (delta > 0) return "text-red-600";
  if (delta < 0) return "text-green-700";
  return "";
}

const COLUMNAS_PRECIO_INSUMO: ColumnaReporte<FilaPrecioInsumo>[] = [
  {
    clave: "insumo",
    etiqueta: "Insumo",
    valor: (f) => f.insumo,
    render: (f) => (
      <span className="flex items-center gap-1">
        {f.insumo}
        {f.sospechoso && (
          <span title="Variación poco creíble para una suba real de precio — probable error de carga (unidad/presentación mal tipeada). Revisá esta compra antes de asumir que es un aumento real." className="text-amber-700 dark:text-amber-600">
            ⚠
          </span>
        )}
      </span>
    ),
  },
  { clave: "grupo", etiqueta: "Categoría", valor: (f) => f.grupo, render: (f) => f.grupo ?? <span className="text-neutral-400">Sin categoría</span> },
  {
    clave: "precioActual",
    etiqueta: "$/unidad este período",
    alinear: "derecha",
    valor: (f) => f.precioUnitarioPromedio,
    render: (f) => `$${f.precioUnitarioPromedio.toLocaleString("es-AR")}`,
    ayuda: "Promedio ponderado por cantidad de todas las compras de este insumo en el período elegido.",
  },
  {
    clave: "precioAnterior",
    etiqueta: "$/unidad antes",
    alinear: "derecha",
    valor: (f) => f.precioUnitarioAnterior,
    render: (f) => (f.precioUnitarioAnterior !== null ? `$${f.precioUnitarioAnterior.toLocaleString("es-AR")}` : <span className="text-neutral-400">primera compra</span>),
    ayuda: "Precio de la última compra de este insumo ANTES de que empezara el período elegido — el punto de comparación.",
  },
  {
    clave: "deltaPct",
    etiqueta: "Δ%",
    alinear: "derecha",
    valor: (f) => f.deltaPct,
    render: (f) => (f.deltaPct !== null ? <span className={claseDelta(f.deltaPct)}>{f.deltaPct > 0 ? "+" : ""}{f.deltaPct}%</span> : <span className="text-neutral-400">—</span>),
  },
  {
    clave: "impacto",
    etiqueta: "Impacto del cambio",
    alinear: "derecha",
    valor: (f) => f.deltaImpacto,
    render: (f) =>
      f.deltaImpacto !== null ? (
        <span className={claseDelta(f.deltaImpacto)}>
          {f.deltaImpacto > 0 ? "+" : ""}${f.deltaImpacto.toLocaleString("es-AR")}
        </span>
      ) : (
        <span className="text-neutral-400">—</span>
      ),
    ayuda: "(precio de este período − precio anterior) × cantidad comprada — lo que ese cambio de precio realmente costó (o ahorró) a la cantidad que compraste. Ordena la tabla por esto, no por %: un insumo barato que sube mucho puede pesar menos que uno caro con una suba moderada.",
  },
];

export function TablaPrecioPorInsumo({ filas }: { filas: FilaPrecioInsumo[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_PRECIO_INSUMO}
      filas={filas}
      claveFila={(f) => f.insumo}
      sinFilasTexto="Sin compras en el período."
      nombreExport="precio-por-insumo"
    />
  );
}

const COLUMNAS_IMPACTO_RECETA: ColumnaReporte<FilaImpactoRecetaPorPeriodo>[] = [
  {
    clave: "producto",
    etiqueta: "Plato",
    valor: (f) => f.productoNombre,
    render: (f) => (
      <EnlaceInterno href={`/catalogo/recetas/${f.productoId}`} className="underline">
        {f.productoNombre}
      </EnlaceInterno>
    ),
  },
  { clave: "costoAntes", etiqueta: "Costo antes", alinear: "derecha", valor: (f) => f.costoAntes, render: (f) => `$${f.costoAntes.toLocaleString("es-AR")}` },
  { clave: "costoActual", etiqueta: "Costo ahora", alinear: "derecha", valor: (f) => f.costoActual, render: (f) => `$${f.costoActual.toLocaleString("es-AR")}` },
  {
    clave: "delta",
    etiqueta: "Δ costo",
    alinear: "derecha",
    valor: (f) => f.deltaCosto,
    render: (f) => <span className={claseDelta(f.deltaCosto)}>{f.deltaCosto > 0 ? "+" : ""}${f.deltaCosto.toLocaleString("es-AR")}</span>,
    ayuda: "Cuánto le pega a este plato el cambio de precio de sus insumos (directo o a través de un intermedio 'se produce', ej. una masa premezclada) — reusa el mismo costeo recursivo que Costos y márgenes, no un cálculo aparte.",
  },
  {
    clave: "foodCost",
    etiqueta: "Food cost %",
    alinear: "derecha",
    valor: (f) => f.foodCostPctActual,
    render: (f) =>
      f.foodCostPctAntes !== null && f.foodCostPctActual !== null ? (
        <span>
          {f.foodCostPctAntes}% <span className={claseDelta(f.foodCostPctActual - f.foodCostPctAntes)}>→ {f.foodCostPctActual}%</span>
        </span>
      ) : (
        <span className="text-neutral-400">sin precio de venta</span>
      ),
  },
];

export function TablaImpactoRecetas({ filas }: { filas: FilaImpactoRecetaPorPeriodo[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_IMPACTO_RECETA}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Ningún plato cambió de costo por variación de precio de insumos en este período."
      nombreExport="impacto-en-recetas"
    />
  );
}
