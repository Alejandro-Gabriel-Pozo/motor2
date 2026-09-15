"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDevolucionProducto } from "@/core/reportes/devoluciones";

const COLUMNAS: ColumnaReporte<FilaDevolucionProducto>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (p) => p.producto,
    render: (p) => (
      <>
        {p.producto} {p.sinPrecio && <span className="text-amber-600">(sin precio)</span>}
      </>
    ),
  },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (p) => p.cantidad, render: (p) => p.cantidad },
  { clave: "valor", etiqueta: "Valor", alinear: "derecha", valor: (p) => p.valor, render: (p) => `$${p.valor.toLocaleString("es-AR")}` },
];

export function TablaDevolucionesClientes({ filas }: { filas: FilaDevolucionProducto[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(c, i) => `${c.producto}-${i}`}
      sinFilasTexto="Sin devoluciones de clientes en el período."
      nombreExport="devoluciones-clientes"
    />
  );
}

export function TablaDevolucionesProveedor({ filas, nombreExport }: { filas: FilaDevolucionProducto[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(p, i) => `${p.producto}-${i}`} nombreExport={nombreExport} />;
}
