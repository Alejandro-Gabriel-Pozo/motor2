"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { EventoHistorialProducto } from "@/core/reportes/historial-producto";

const COLUMNAS: ColumnaReporte<EventoHistorialProducto>[] = [
  { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (ev) => ev.fecha.toISOString().slice(0, 10), render: (ev) => ev.fecha.toISOString().slice(0, 10) },
  { clave: "tipo", etiqueta: "Tipo", valor: (ev) => (ev.tipo === "movimiento" ? (ev.proceso ?? "") : "Conteo"), render: (ev) => (ev.tipo === "movimiento" ? ev.proceso : "Conteo") },
  { clave: "detalle", etiqueta: "Detalle", valor: (ev) => ev.detalle, render: (ev) => ev.detalle },
  { clave: "seccion", etiqueta: "Sección", valor: (ev) => ev.seccionNombre, render: (ev) => ev.seccionNombre },
  {
    clave: "cantidad",
    etiqueta: "Cantidad",
    alinear: "derecha",
    valor: (ev) => (ev.tipo === "movimiento" ? (ev.cantidadConSigno ?? 0) : (ev.conteoReal ?? 0)),
    render: (ev) => (ev.tipo === "movimiento" ? ev.cantidadConSigno : `${ev.conteoReal} (dif. ${ev.diferencia})`),
  },
  {
    clave: "saldo",
    etiqueta: "Saldo corriente",
    alinear: "derecha",
    valor: (ev) => (ev.tipo === "movimiento" ? (ev.saldoCorriente ?? null) : null),
    render: (ev) => (ev.tipo === "movimiento" ? ev.saldoCorriente : "—"),
  },
];

export function TablaHistorialEventos({ filas, nombreExport }: { filas: EventoHistorialProducto[]; nombreExport: string }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(ev, i) => `${ev.fecha.toISOString()}-${i}`}
      sinFilasTexto="Sin eventos en el rango elegido."
      nombreExport={nombreExport}
    />
  );
}
