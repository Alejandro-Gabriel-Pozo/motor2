"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPromocion } from "@/core/reportes/promociones";

const COLUMNAS: ColumnaReporte<FilaPromocion>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (p) => p.producto, render: (p) => p.producto },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (p) => p.cantidad, render: (p) => p.cantidad },
  { clave: "importe", etiqueta: "Facturado", alinear: "derecha", valor: (p) => p.importe, render: (p) => `$${p.importe.toLocaleString("es-AR")}` },
  {
    clave: "valorCarta",
    etiqueta: "Valor a la carta",
    alinear: "derecha",
    valor: (p) => p.valorALaCartaUnitario,
    render: (p) => (p.valorALaCartaUnitario === null ? <span className="text-amber-600">incompleto</span> : `$${p.valorALaCartaUnitario.toLocaleString("es-AR")}`),
  },
  { clave: "descuento", etiqueta: "Descuento", alinear: "derecha", valor: (p) => p.descuentoPct, render: (p) => (p.descuentoPct === null ? "—" : `${p.descuentoPct}%`) },
  {
    clave: "margenReal",
    etiqueta: "Margen Real",
    alinear: "derecha",
    valor: (p) => p.margenReal,
    ayuda:
      "Mismo cálculo que el Margen Real de Período: costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó. \"parcial\" si alguna venta de este producto no se pudo costear así.",
    render: (p) =>
      p.margenReal === null ? (
        <span className="text-neutral-400">—</span>
      ) : (
        <>
          ${p.margenReal.toLocaleString("es-AR")}
          {p.margenRealReconstruido ? " · reconstruido" : ""}
          {!p.margenRealCompleto && <span className="text-amber-700"> · parcial</span>}
        </>
      ),
  },
];

export function TablaPromociones({ filas }: { filas: FilaPromocion[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(p, i) => `${p.producto}-${i}`}
      sinFilasTexto="Sin ventas de promociones este mes."
      nombreExport="promociones"
    />
  );
}
