"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import { formatearMonto } from "@/core/formato-de-numero";
import { textoDe } from "@/core/textos/texto-de";

export interface FilaProductoCategoria {
  producto: string;
  cantidad: number;
  importe: number;
}

const COLUMNAS: ColumnaReporte<FilaProductoCategoria>[] = [
  { clave: "producto", etiqueta: textoDe("columna.producto"), valor: (p) => p.producto, render: (p) => p.producto },
  { clave: "cantidad", etiqueta: textoDe("columna.cantidad"), alinear: "derecha", valor: (p) => p.cantidad, render: (p) => p.cantidad },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (p) => p.importe, render: (p) => `${formatearMonto(p.importe)}` },
];

export function TablaProductosCategoria({ filas, nombreExport }: { filas: FilaProductoCategoria[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(p, i) => `${p.producto}-${i}`} nombreExport={nombreExport} />;
}
