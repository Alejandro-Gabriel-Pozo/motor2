"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPerdida } from "@/core/reportes/perdidas";

// `FilaPerdida.motivo` ya viene resuelto a su nombre legible (perdidas.ts, plan "motivos de Consumo/Merma como catálogo
// administrable", P4) — ya no hace falta un Map enum→label acá.
function columnas(): ColumnaReporte<FilaPerdida>[] {
  return [
    { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (f) => f.fecha.toISOString().slice(0, 10), render: (f) => f.fecha.toISOString().slice(0, 10) },
    {
      clave: "motivo",
      etiqueta: "Motivo",
      valor: (f) => f.motivo,
      render: (f) => f.motivo,
    },
    { clave: "producto", etiqueta: "Producto", valor: (f) => f.producto, render: (f) => f.producto },
    { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (f) => f.cantidad, render: (f) => f.cantidad },
    {
      clave: "valor",
      etiqueta: "Valor",
      alinear: "derecha",
      valor: (f) => f.valor,
      render: (f) => (f.sinPrecio ? <span className="text-amber-700 dark:text-amber-600">costo incompleto</span> : `$${f.valor.toLocaleString("es-AR")}`),
    },
    {
      clave: "trazabilidad",
      etiqueta: "",
      render: (f) => (
        <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${f.idOperacion}`} className="text-sm underline">
          Ver operación
        </EnlaceInterno>
      ),
    },
  ];
}

const COLUMNAS_MERMA = columnas();
const COLUMNAS_CONSUMO = columnas().map((c) => (c.clave === "motivo" ? { ...c, etiqueta: "Destino" } : c));

export function TablaMermas({ filas }: { filas: FilaPerdida[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_MERMA}
      filas={filas}
      claveFila={(f) => f.idMovimiento}
      sinFilasTexto="Sin mermas en el período."
      nombreExport="mermas"
      ordenInicial="fecha"
      direccionInicial="desc"
    />
  );
}

export function TablaConsumoInterno({ filas }: { filas: FilaPerdida[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_CONSUMO}
      filas={filas}
      claveFila={(f) => f.idMovimiento}
      sinFilasTexto="Sin consumo interno en el período."
      nombreExport="consumo-interno"
      ordenInicial="fecha"
      direccionInicial="desc"
    />
  );
}
