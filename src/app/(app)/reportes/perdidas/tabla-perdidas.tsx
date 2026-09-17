"use client";

import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaPerdida, FilaPerdidaProducto } from "@/core/reportes/perdidas";
import { MOTIVOS_MERMA, DESTINOS_CONSUMO } from "@/core/movimientos/ui-config";

const ETIQUETA_MOTIVO_MERMA = new Map<string, string>(MOTIVOS_MERMA.map((m) => [m.value, m.label]));
// "(automático por receta)" (SIN_DESTINO en perdidas.ts) es un literal fijo, no un valor del enum — el Map de string a string lo deja pasar tal cual (miss -> undefined -> fallback al motivo crudo).
const ETIQUETA_DESTINO_CONSUMO = new Map<string, string>(DESTINOS_CONSUMO.map((d) => [d.value, d.label]));

function textoProductos(productos: FilaPerdidaProducto[]): string {
  return productos.map((p) => `${p.nombre}${p.sinPrecio ? " (sin precio)" : ""}`).join(", ");
}

const COLUMNAS_MERMA: ColumnaReporte<FilaPerdida>[] = [
  {
    clave: "motivo",
    etiqueta: "Motivo",
    valor: (m) => ETIQUETA_MOTIVO_MERMA.get(m.motivo) ?? m.motivo,
    render: (m) => (
      <>
        {ETIQUETA_MOTIVO_MERMA.get(m.motivo) ?? m.motivo} {m.costoIncompleto && <span className="text-amber-600">(costo incompleto)</span>}
      </>
    ),
  },
  {
    clave: "productos",
    etiqueta: "Productos",
    valor: (m) => textoProductos(m.productos),
    render: (m) => <span className="text-neutral-500">{textoProductos(m.productos)}</span>,
  },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (m) => m.cantidad, render: (m) => m.cantidad },
  { clave: "valor", etiqueta: "Valor", alinear: "derecha", valor: (m) => m.valor, render: (m) => `$${m.valor.toLocaleString("es-AR")}` },
];

const COLUMNAS_CONSUMO: ColumnaReporte<FilaPerdida>[] = [
  {
    clave: "motivo",
    etiqueta: "Destino",
    valor: (m) => ETIQUETA_DESTINO_CONSUMO.get(m.motivo) ?? m.motivo,
    render: (m) => (
      <>
        {ETIQUETA_DESTINO_CONSUMO.get(m.motivo) ?? m.motivo} {m.costoIncompleto && <span className="text-amber-600">(costo incompleto)</span>}
      </>
    ),
  },
  {
    clave: "productos",
    etiqueta: "Productos",
    valor: (m) => textoProductos(m.productos),
    render: (m) => <span className="text-neutral-500">{textoProductos(m.productos)}</span>,
  },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (m) => m.cantidad, render: (m) => m.cantidad },
  { clave: "valor", etiqueta: "Valor", alinear: "derecha", valor: (m) => m.valor, render: (m) => `$${m.valor.toLocaleString("es-AR")}` },
];

export function TablaMermas({ filas }: { filas: FilaPerdida[] }) {
  return (
    <TablaReporte columnas={COLUMNAS_MERMA} filas={filas} claveFila={(m, i) => `${m.motivo}-${i}`} sinFilasTexto="Sin mermas en el período." nombreExport="mermas-por-motivo" />
  );
}

export function TablaConsumoInterno({ filas }: { filas: FilaPerdida[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_CONSUMO}
      filas={filas}
      claveFila={(c, i) => `${c.motivo}-${i}`}
      sinFilasTexto="Sin consumo interno en el período."
      nombreExport="consumo-interno"
    />
  );
}
