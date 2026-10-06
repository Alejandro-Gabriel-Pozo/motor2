"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDescuentoProducto } from "@/core/reportes/descuentos-productos";

const COLUMNAS: ColumnaReporte<FilaDescuentoProducto>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (f) => f.producto, render: (f) => f.producto },
  { clave: "unidades", etiqueta: "Unidades", alinear: "derecha", valor: (f) => f.unidades, render: (f) => f.unidades.toLocaleString("es-AR") },
  { clave: "importeALista", etiqueta: "A precio de lista", alinear: "derecha", valor: (f) => f.importeALista, render: (f) => `$${f.importeALista.toLocaleString("es-AR")}` },
  { clave: "importeCobrado", etiqueta: "Cobrado", alinear: "derecha", valor: (f) => f.importeCobrado, render: (f) => `$${f.importeCobrado.toLocaleString("es-AR")}` },
  {
    clave: "ahorro",
    etiqueta: "Ahorro",
    alinear: "derecha",
    valor: (f) => f.ahorro,
    render: (f) => `$${f.ahorro.toLocaleString("es-AR")}${f.descuentoEfectivoPct !== null ? ` (${f.descuentoEfectivoPct}%)` : ""}`,
  },
];

export function TablaDescuentosProductos({ filas }: { filas: FilaDescuentoProducto[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Ningún producto con descuento se vendió en este rango."
      nombreExport="descuentos-productos"
      ordenInicial="ahorro"
      direccionInicial="desc"
    />
  );
}
