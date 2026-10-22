"use client";

import { IconoDeAccion } from "@/components/iconos";
import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPerdida } from "@/core/reportes/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

/** El día de calendario de un instante en hora argentina (P1): `Operacion.fecha` es un instante; leerlo en UTC mostraba el día siguiente a partir de las 21:00. */
const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);

// `FilaPerdida.motivo` ya viene resuelto a su nombre legible (perdidas.ts, plan "motivos de Consumo/Merma como catálogo
// administrable", P4) — ya no hace falta un Map enum→label acá.
function columnas(): ColumnaReporte<FilaPerdida>[] {
  return [
    { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (f) => dia(f.fecha), render: (f) => dia(f.fecha) },
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
      render: (f) => (f.sinPrecio ? <span className="text-aviso-tinta">costo incompleto</span> : `$${f.valor.toLocaleString("es-AR")}`),
    },
    {
      clave: "trazabilidad",
      etiqueta: "",
      render: (f) => (
        <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${f.idOperacion}`} className="text-sm underline inline-flex items-center gap-1">
          <IconoDeAccion id="ver" />
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
