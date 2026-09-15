"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";

export interface FilaConteo {
  id: string;
  fecha: Date;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  seccionNombre: string;
  saldoSistema: number;
  conteoReal: number;
  diferencia: number;
  accion: string;
  estado: string;
}

const COLUMNAS: ColumnaReporte<FilaConteo>[] = [
  { clave: "fecha", etiqueta: "Fecha", valor: (c) => c.fecha.toISOString().slice(0, 10), render: (c) => c.fecha.toISOString().slice(0, 10) },
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (c) => `${c.productoCodigo} — ${c.productoNombre}`,
    render: (c) => (
      <Link href={`/reportes/historial?productoId=${c.productoId}`} className="underline">
        {c.productoCodigo} — {c.productoNombre}
      </Link>
    ),
  },
  { clave: "seccion", etiqueta: "Sección", valor: (c) => c.seccionNombre, render: (c) => c.seccionNombre },
  { clave: "sistema", etiqueta: "Sistema", alinear: "derecha", valor: (c) => c.saldoSistema, render: (c) => c.saldoSistema },
  { clave: "real", etiqueta: "Real", alinear: "derecha", valor: (c) => c.conteoReal, render: (c) => c.conteoReal },
  {
    clave: "diferencia",
    etiqueta: "Diferencia",
    alinear: "derecha",
    valor: (c) => c.diferencia,
    render: (c) => <span className={c.diferencia !== 0 ? "font-medium" : ""}>{c.diferencia}</span>,
  },
  { clave: "accion", etiqueta: "Acción", valor: (c) => c.accion, render: (c) => c.accion },
  { clave: "estado", etiqueta: "Estado", valor: (c) => c.estado, render: (c) => c.estado },
];

export function TablaHistorialConteos({ filas }: { filas: FilaConteo[] }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(c) => c.id} sinFilasTexto="Sin conteos registrados todavía." nombreExport="historial-conteos" />;
}
