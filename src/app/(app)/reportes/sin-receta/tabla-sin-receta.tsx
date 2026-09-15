"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaVentaSinReceta } from "@/core/reportes/ventas-sin-receta";

const COLUMNAS: ColumnaReporte<FilaVentaSinReceta>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (f) => `${f.codigo} — ${f.producto}`,
    render: (f) => (
      <Link href={`/reportes/historial?productoId=${f.productoId}`} className="underline">
        {f.codigo} — {f.producto}
      </Link>
    ),
  },
  { clave: "cantidad", etiqueta: "Ventas sin receta", alinear: "derecha", valor: (f) => f.cantidadVentasSinReceta, render: (f) => f.cantidadVentasSinReceta },
  { clave: "primera", etiqueta: "Primera", valor: (f) => f.primeraFecha.toISOString().slice(0, 10), render: (f) => f.primeraFecha.toISOString().slice(0, 10) },
  { clave: "ultima", etiqueta: "Última", valor: (f) => f.ultimaFecha.toISOString().slice(0, 10), render: (f) => f.ultimaFecha.toISOString().slice(0, 10) },
];

export function TablaVentasSinReceta({ filas }: { filas: FilaVentaSinReceta[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Todas las ventas registradas generaron consumo de receta."
      nombreExport="ventas-sin-receta"
    />
  );
}
