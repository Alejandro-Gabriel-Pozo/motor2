"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";

export interface FilaCategoriaDeSeccion {
  categoria: string;
  cantidad: number;
  importe: number;
}

const COLUMNAS: ColumnaReporte<FilaCategoriaDeSeccion>[] = [
  { clave: "categoria", etiqueta: "Categoría", valor: (c) => c.categoria, render: (c) => c.categoria },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (c) => c.cantidad, render: (c) => c.cantidad },
  { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (c) => c.importe, render: (c) => `$${c.importe.toLocaleString("es-AR")}` },
];

export function TablaCategoriasDeSeccion({ filas, nombreExport }: { filas: FilaCategoriaDeSeccion[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(c) => c.categoria} nombreExport={nombreExport} />;
}
