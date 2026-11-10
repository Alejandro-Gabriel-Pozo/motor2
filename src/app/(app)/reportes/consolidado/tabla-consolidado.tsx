"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaResumenConsolidado } from "@/core/reportes/public";
import { formatearMonto } from "@/core/formato-de-numero";

const COLUMNAS: ColumnaReporte<FilaResumenConsolidado>[] = [
  { clave: "sucursal", etiqueta: "Sucursal", valor: (f) => f.sucursalNombre, render: (f) => f.sucursalNombre },
  { clave: "ventas", etiqueta: "Ventas del mes", alinear: "derecha", valor: (f) => f.ventasTotal, render: (f) => `${formatearMonto(f.ventasTotal)}` },
  { clave: "margen", etiqueta: "Margen del mes", alinear: "derecha", valor: (f) => f.margenTotal, render: (f) => `${formatearMonto(f.margenTotal)}` },
  { clave: "gastado", etiqueta: "Gastado en compras", alinear: "derecha", valor: (f) => f.gastadoTotal, render: (f) => `${formatearMonto(f.gastadoTotal)}` },
  { clave: "criticas", etiqueta: "Alertas críticas", alinear: "derecha", valor: (f) => f.alertasCriticas, render: (f) => f.alertasCriticas },
  { clave: "bajas", etiqueta: "Alertas bajas", alinear: "derecha", valor: (f) => f.alertasBajas, render: (f) => f.alertasBajas },
];

export function TablaConsolidado({ filas }: { filas: FilaResumenConsolidado[] }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(f) => f.sucursalId} nombreExport="resumen-consolidado" />;
}
