"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPerdida } from "@/core/reportes/perdidas";

const COLUMNAS: ColumnaReporte<FilaPerdida>[] = [
  {
    clave: "motivo",
    etiqueta: "Motivo",
    valor: (m) => m.motivo,
    render: (m) => (
      <>
        {m.motivo} {m.costoIncompleto && <span className="text-amber-600">(costo incompleto)</span>}
      </>
    ),
  },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (m) => m.cantidad, render: (m) => m.cantidad },
  { clave: "valor", etiqueta: "Valor", alinear: "derecha", valor: (m) => m.valor, render: (m) => `$${m.valor.toLocaleString("es-AR")}` },
];

export function TablaMermas({ filas }: { filas: FilaPerdida[] }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(m, i) => `${m.motivo}-${i}`} sinFilasTexto="Sin mermas en el período." nombreExport="mermas-por-motivo" />;
}

export function TablaConsumoInterno({ filas }: { filas: FilaPerdida[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(c, i) => `${c.motivo}-${i}`}
      sinFilasTexto="Sin consumo interno en el período."
      nombreExport="consumo-interno"
    />
  );
}
