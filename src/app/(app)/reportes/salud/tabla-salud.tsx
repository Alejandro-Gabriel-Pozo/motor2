"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaSaludProducto } from "@/core/reportes/salud-por-producto";
import { ESTADO_STOCK_CONSOLIDADO_LABEL, ESTADO_STOCK_CONSOLIDADO_COLOR } from "@/core/stock/estado-consolidado-ui";

const COLUMNAS: ColumnaReporte<FilaSaludProducto>[] = [
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
  { clave: "seccion", etiqueta: "Sección", valor: (f) => f.seccionNombre, render: (f) => f.seccionNombre },
  {
    clave: "consolidado",
    etiqueta: "Consolidado",
    valor: (f) => f.estadoConsolidado,
    render: (f) => <span className={ESTADO_STOCK_CONSOLIDADO_COLOR[f.estadoConsolidado]}>{ESTADO_STOCK_CONSOLIDADO_LABEL[f.estadoConsolidado]}</span>,
  },
  { clave: "alerta", etiqueta: "Alerta", valor: (f) => f.estadoAlerta, render: (f) => f.estadoAlerta },
  { clave: "diferencias", etiqueta: "Diferencias", valor: (f) => f.estadoDiferencias, render: (f) => f.estadoDiferencias },
  { clave: "sinReceta", etiqueta: "Sin receta", valor: (f) => (f.sinRecetaVinculada ? "Sí" : "No"), render: (f) => (f.sinRecetaVinculada ? "Sí" : "No") },
  {
    clave: "resumen",
    etiqueta: "Resumen",
    valor: (f) => f.resumen,
    render: (f) => <span className={f.resumen === "Atención" ? "font-medium text-red-600" : "text-neutral-500"}>{f.resumen}</span>,
  },
];

export function TablaSaludPorProducto({ filas }: { filas: FilaSaludProducto[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f, i) => `${f.productoId}-${f.seccionNombre}-${i}`}
      sinFilasTexto="Sin productos con movimientos o conteos todavía."
      nombreExport="salud-por-producto"
    />
  );
}
