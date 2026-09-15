"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDiferenciaAjuste } from "@/core/reportes/diferencias-ajustes";

const LABEL_ESTADO: Record<string, string> = { REVISAR: "Revisar", ESPERADO: "Esperado", OK: "OK" };

const COLUMNAS: ColumnaReporte<FilaDiferenciaAjuste>[] = [
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
  { clave: "grupo", etiqueta: "Grupo", valor: (f) => f.grupoTexto, render: (f) => f.grupoTexto },
  { clave: "sumaAjustes", etiqueta: "Suma ajustes", alinear: "derecha", valor: (f) => f.sumaAjustesManuales, render: (f) => f.sumaAjustesManuales },
  {
    clave: "ultimoAjuste",
    etiqueta: "Último ajuste",
    valor: (f) => (f.ultimaFechaAjuste ? f.ultimaFechaAjuste.toISOString().slice(0, 10) : ""),
    render: (f) => (f.ultimaFechaAjuste ? f.ultimaFechaAjuste.toISOString().slice(0, 10) : "—"),
  },
  { clave: "sumaConteos", etiqueta: "Suma conteos", alinear: "derecha", valor: (f) => f.sumaConteosFisicos, render: (f) => f.sumaConteosFisicos },
  {
    clave: "ultimoConteo",
    etiqueta: "Último conteo",
    valor: (f) => (f.ultimaFechaConteo ? f.ultimaFechaConteo.toISOString().slice(0, 10) : ""),
    render: (f) => (f.ultimaFechaConteo ? f.ultimaFechaConteo.toISOString().slice(0, 10) : "—"),
  },
  {
    clave: "estado",
    etiqueta: "Estado",
    valor: (f) => LABEL_ESTADO[f.estado],
    render: (f) => <span className={f.estado === "REVISAR" ? "font-medium text-red-600" : f.estado === "ESPERADO" ? "text-amber-600" : ""}>{LABEL_ESTADO[f.estado]}</span>,
  },
];

export function TablaDiferenciasAjuste({ filas }: { filas: FilaDiferenciaAjuste[] }) {
  return (
    <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(f) => f.productoId} sinFilasTexto="Sin materias primas cargadas." nombreExport="diferencias-ajuste" />
  );
}
