"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { OperacionEncontrada, ItemOperacion } from "@/core/reportes/trazabilidad";

const COLUMNAS_ENCONTRADAS: ColumnaReporte<OperacionEncontrada>[] = [
  { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (e) => e.fecha.toISOString().slice(0, 10), render: (e) => e.fecha.toISOString().slice(0, 10) },
  { clave: "proceso", etiqueta: "Proceso", valor: (e) => e.proceso, render: (e) => e.proceso },
  { clave: "seccion", etiqueta: "Sección", valor: (e) => e.seccionNombre, render: (e) => e.seccionNombre },
  {
    clave: "ver",
    etiqueta: "",
    render: (e) => (
      <Link href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(e.idOperacion)}`} className="underline">
        Ver operación
      </Link>
    ),
  },
];

const COLUMNAS_ITEMS: ColumnaReporte<ItemOperacion>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (it) => `${it.productoCodigo} — ${it.productoNombre}`, render: (it) => `${it.productoCodigo} — ${it.productoNombre}` },
  { clave: "proceso", etiqueta: "Proceso", valor: (it) => it.proceso, render: (it) => it.proceso },
  { clave: "seccion", etiqueta: "Sección", valor: (it) => it.seccionNombre, render: (it) => it.seccionNombre },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (it) => it.cantidad, render: (it) => it.cantidad },
  { clave: "detalle", etiqueta: "Detalle", valor: (it) => it.detalle, render: (it) => it.detalle },
];

export function TablaOperacionesEncontradas({ filas }: { filas: OperacionEncontrada[] }) {
  return <TablaReporte columnas={COLUMNAS_ENCONTRADAS} filas={filas} claveFila={(e) => e.idOperacion} />;
}

export function TablaItemsOperacion({ filas, nombreExport }: { filas: ItemOperacion[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS_ITEMS} filas={filas} claveFila={(it) => it.idMovimiento} nombreExport={nombreExport} />;
}
