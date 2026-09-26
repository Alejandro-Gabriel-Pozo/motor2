"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDescuentoCliente } from "@/core/reportes/descuentos-clientes";

const AYUDA_MARGEN =
  'Costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (mismo criterio que Período/Promociones). "parcial" si alguna venta de ese cliente no se pudo costear así.';

function celdaMargen(valor: number | null, pct: number | null, reconstruido: boolean, completo: boolean) {
  if (valor === null) return <span className="text-neutral-500 dark:text-neutral-400">—</span>;
  return (
    <>
      ${valor.toLocaleString("es-AR")} ({pct}%)
      {reconstruido ? " · reconstruido" : ""}
      {!completo && <span className="text-amber-700 dark:text-amber-600"> · parcial</span>}
    </>
  );
}

const COLUMNAS: ColumnaReporte<FilaDescuentoCliente>[] = [
  { clave: "cliente", etiqueta: "Cliente", valor: (f) => f.cliente, render: (f) => f.cliente },
  { clave: "cantidadVentas", etiqueta: "Ventas", alinear: "derecha", valor: (f) => f.cantidadVentas, render: (f) => f.cantidadVentas.toLocaleString("es-AR") },
  { clave: "ingresoALista", etiqueta: "A precio de lista", alinear: "derecha", valor: (f) => f.ingresoALista, render: (f) => `$${f.ingresoALista.toLocaleString("es-AR")}` },
  { clave: "ingresoCobrado", etiqueta: "Cobrado", alinear: "derecha", valor: (f) => f.ingresoCobrado, render: (f) => `$${f.ingresoCobrado.toLocaleString("es-AR")}` },
  {
    clave: "totalDescontado",
    etiqueta: "Descontado",
    alinear: "derecha",
    valor: (f) => f.totalDescontado,
    render: (f) => `$${f.totalDescontado.toLocaleString("es-AR")}${f.descuentoEfectivoPct !== null ? ` (${f.descuentoEfectivoPct}%)` : ""}`,
  },
  {
    clave: "margenReal",
    etiqueta: "Margen Real (cobrado)",
    alinear: "derecha",
    valor: (f) => f.margenReal,
    ayuda: AYUDA_MARGEN,
    render: (f) => celdaMargen(f.margenReal, f.margenRealPct, f.margenRealReconstruido, f.margenRealCompleto),
  },
  {
    clave: "margenRealALista",
    etiqueta: "Margen Real (a lista)",
    alinear: "derecha",
    valor: (f) => f.margenRealALista,
    ayuda: "El margen que hubiera dado la MISMA venta sin el descuento, con el mismo costo real de la columna anterior — para ver si el descuento dejó al cliente con un margen sano.",
    render: (f) => celdaMargen(f.margenRealALista, f.margenRealAListaPct, f.margenRealReconstruido, f.margenRealCompleto),
  },
];

export function TablaDescuentosClientes({ filas }: { filas: FilaDescuentoCliente[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.clienteId}
      sinFilasTexto="Ningún cliente con descuento tuvo ventas en este rango."
      nombreExport="descuentos-clientes"
      ordenInicial="totalDescontado"
      direccionInicial="desc"
    />
  );
}
