"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDevolucionProducto } from "@/core/reportes/devoluciones";

const COLUMNAS: ColumnaReporte<FilaDevolucionProducto>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (p) => p.producto, render: (p) => p.producto },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (p) => p.cantidad, render: (p) => p.cantidad },
  {
    clave: "valor",
    etiqueta: "Valor",
    alinear: "derecha",
    valor: (p) => p.valor,
    render: (p) =>
      p.accionFaltante ? (
        <EnlaceInterno href={p.accionFaltante.href} className="text-amber-600 underline">
          {p.accionFaltante.etiqueta}
        </EnlaceInterno>
      ) : (
        `$${p.valor.toLocaleString("es-AR")}`
      ),
  },
];

export function TablaDevolucionesClientes({ filas }: { filas: FilaDevolucionProducto[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(c) => c.productoId}
      sinFilasTexto="Sin devoluciones de clientes en el período."
      nombreExport="devoluciones-clientes"
    />
  );
}

export function TablaDevolucionesProveedor({ filas, nombreExport }: { filas: FilaDevolucionProducto[]; nombreExport: string }) {
  return <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(p) => p.productoId} nombreExport={nombreExport} />;
}
