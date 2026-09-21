"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaInsumoSinReceta } from "@/core/reportes/insumos-sin-receta";

const COLUMNAS: ColumnaReporte<FilaInsumoSinReceta>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (f) => `${f.codigo} — ${f.producto}`,
    render: (f) => (
      <EnlaceInterno href={`/reportes/historial?productoId=${f.productoId}`} className="underline">
        {f.codigo} — {f.producto}
      </EnlaceInterno>
    ),
  },
  { clave: "insumo", etiqueta: "Insumo", valor: (f) => f.insumoNombre ?? "", render: (f) => f.insumoNombre ?? "—" },
  {
    clave: "proveedor",
    etiqueta: "Tiene proveedor",
    valor: (f) => (f.tieneProveedor ? "Sí" : "No"),
    render: (f) => (f.tieneProveedor ? "Sí" : <span className="text-amber-700 dark:text-amber-600">No</span>),
  },
];

export function TablaInsumosSinReceta({ filas }: { filas: FilaInsumoSinReceta[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Todas las materias primas activas están vinculadas a alguna receta."
      nombreExport="insumos-sin-receta"
    />
  );
}
