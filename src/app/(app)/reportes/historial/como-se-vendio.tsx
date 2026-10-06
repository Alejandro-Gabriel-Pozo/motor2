"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaVentaPorDia } from "@/core/reportes/public";

/** Tope defensivo (§4): un rango sin acotar (ej. "Todo el historial") no debería poder inflar esta tabla sin límite. */
const TOPE_DIAS = 180;

function columnas(mostrarDinero: boolean): ColumnaReporte<FilaVentaPorDia>[] {
  const base: ColumnaReporte<FilaVentaPorDia>[] = [
    { clave: "dia", etiqueta: "Día", tipoFecha: "dia", valor: (f) => f.dia, render: (f) => f.dia },
    { clave: "cantidad", etiqueta: "Cantidad vendida", alinear: "derecha", valor: (f) => f.cantidad, render: (f) => f.cantidad },
  ];
  if (mostrarDinero) {
    base.push(
      { clave: "importe", etiqueta: "Importe", alinear: "derecha", valor: (f) => f.importe, render: (f) => `$${f.importe.toLocaleString("es-AR")}` },
      { clave: "precioPromedio", etiqueta: "Precio promedio", alinear: "derecha", valor: (f) => f.precioPromedio, render: (f) => (f.precioPromedio !== null ? `$${f.precioPromedio.toLocaleString("es-AR")}` : "—") }
    );
  }
  return base;
}

/** "Cómo se vendió" (PV) — ventas agrupadas por día, EXCLUYE anuladas (ver agruparVentasPorDia). Se muestra para cualquier PV, tenga o no stock propio. */
export function ComoSeVendio({ filas, mostrarDinero }: { filas: FilaVentaPorDia[]; mostrarDinero: boolean }) {
  const recortadas = filas.length > TOPE_DIAS ? filas.slice(-TOPE_DIAS) : filas;

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium">Cómo se vendió</h3>
      {recortadas.length < filas.length && <p className="mb-2 text-xs text-neutral-500">Se muestran los últimos {TOPE_DIAS} días con ventas.</p>}
      <TablaReporte columnas={columnas(mostrarDinero)} filas={recortadas} claveFila={(f) => f.dia} sinFilasTexto="Sin ventas en el rango elegido." nombreExport="como-se-vendio" />
    </div>
  );
}
