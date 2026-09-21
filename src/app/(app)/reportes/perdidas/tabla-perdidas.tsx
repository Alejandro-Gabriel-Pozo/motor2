"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPerdida } from "@/core/reportes/perdidas";
import { MOTIVOS_MERMA, DESTINOS_CONSUMO } from "@/core/movimientos/ui-config";

const ETIQUETA_MOTIVO_MERMA = new Map<string, string>(MOTIVOS_MERMA.map((m) => [m.value, m.label]));
// "(automático por receta)" (SIN_DESTINO en perdidas.ts) es un literal fijo, no un valor del enum — el Map de string a string lo deja pasar tal cual (miss -> undefined -> fallback al motivo crudo).
const ETIQUETA_DESTINO_CONSUMO = new Map<string, string>(DESTINOS_CONSUMO.map((d) => [d.value, d.label]));

function columnas(etiquetaMotivo: Map<string, string>): ColumnaReporte<FilaPerdida>[] {
  return [
    { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (f) => f.fecha.toISOString().slice(0, 10), render: (f) => f.fecha.toISOString().slice(0, 10) },
    {
      clave: "motivo",
      etiqueta: "Motivo",
      valor: (f) => etiquetaMotivo.get(f.motivo) ?? f.motivo,
      render: (f) => etiquetaMotivo.get(f.motivo) ?? f.motivo,
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

const COLUMNAS_MERMA = columnas(ETIQUETA_MOTIVO_MERMA);
const COLUMNAS_CONSUMO = columnas(ETIQUETA_DESTINO_CONSUMO).map((c) => (c.clave === "motivo" ? { ...c, etiqueta: "Destino" } : c));

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
