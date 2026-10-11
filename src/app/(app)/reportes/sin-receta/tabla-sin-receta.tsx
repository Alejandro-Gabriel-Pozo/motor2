"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaVentaSinReceta } from "@/core/reportes/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

/** El día de calendario de un instante en hora argentina (P1): `Operacion.fecha` es un instante; leerlo en UTC mostraba el día siguiente a partir de las 21:00. */
const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);

const COLUMNAS: ColumnaReporte<FilaVentaSinReceta>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (f) => `${f.codigo} — ${f.producto}`,
    render: (f) => (
      <EnlaceInterno href={`/reportes/historial?productoId=${f.productoId}`} className="underline">
        {f.codigo} — {f.producto}
      </EnlaceInterno>
    ),
  },
  { clave: "cantidad", etiqueta: "Ventas sin receta", alinear: "derecha", valor: (f) => f.cantidadVentasSinReceta, render: (f) => f.cantidadVentasSinReceta },
  { clave: "primera", etiqueta: "Primera", tipoFecha: "dia", valor: (f) => dia(f.primeraFecha), render: (f) => dia(f.primeraFecha) },
  { clave: "ultima", etiqueta: "Última", tipoFecha: "dia", valor: (f) => dia(f.ultimaFecha), render: (f) => dia(f.ultimaFecha) },
];

export function TablaVentasSinReceta({ filas }: { filas: FilaVentaSinReceta[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS}
      filas={filas}
      claveFila={(f) => f.productoId}
      sinFilasTexto="Todas las ventas registradas generaron consumo de receta."
      nombreExport="ventas-sin-receta"
    />
  );
}
