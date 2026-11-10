"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import { formatearMonto } from "@/core/formato-de-numero";

export interface FilaProductoCategoria {
  producto: string;
  cantidad: number;
  importe: number;
}

const COLUMNAS: ColumnaReporte<FilaProductoCategoria>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (p) => p.producto, render: (p) => p.producto },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (p) => p.cantidad, render: (p) => p.cantidad },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (p) => p.importe, render: (p) => `${formatearMonto(p.importe)}` },
];

export function TablaProductosCategoria({ filas, nombreExport }: { filas: FilaProductoCategoria[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(p, i) => `${p.producto}-${i}`} nombreExport={nombreExport} />;
}
