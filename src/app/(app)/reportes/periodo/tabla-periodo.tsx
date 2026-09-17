"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaMargenProducto, FilaCompraPorProveedor } from "@/core/reportes/periodo";

const COLUMNAS_VENTAS: ColumnaReporte<FilaMargenProducto>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (v) => v.producto,
    render: (v) => (
      <Link href={`/reportes/historial?productoId=${v.productoId}`} className="underline">
        {v.producto} {v.ingresoEstimado && <span className="text-amber-600">(estimado)</span>}
      </Link>
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
          <Link href={v.accionFaltante.href} className="text-amber-600 underline">
            {v.accionFaltante.etiqueta}
          </Link>
        );
      }
      return <span className="text-amber-600">costo incompleto</span>;
    },
  },
];

const COLUMNAS_COMPRAS: ColumnaReporte<FilaCompraPorProveedor>[] = [
  { clave: "proveedor", etiqueta: "Proveedor", valor: (p) => p.proveedor, render: (p) => p.proveedor },
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

export function TablaVentasPorProducto({ filas }: { filas: FilaMargenProducto[] }) {
  return (
    <TablaReporte columnas={COLUMNAS_VENTAS} filas={filas} claveFila={(v) => v.productoId} sinFilasTexto="Sin ventas en el período." nombreExport="ventas-por-producto" />
  );
}

export function TablaComprasPorProveedor({ filas }: { filas: FilaCompraPorProveedor[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_COMPRAS}
      filas={filas}
      claveFila={(p) => p.proveedor}
      sinFilasTexto="Sin compras en el período."
      nombreExport="compras-por-proveedor"
    />
  );
}
