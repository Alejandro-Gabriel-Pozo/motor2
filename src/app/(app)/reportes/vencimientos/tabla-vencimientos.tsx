"use client";

import Link from "next/link";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { obtenerReporteVencimientosDatos } from "@/core/reportes/vencimientos";

const AYUDA_ESTADO_CONCILIACION =
  "Un lote que tenía saldo contado y en el conteo siguiente desapareció (quedó en 0 o sin contar) — se compara cuánto desapareció contra cuánto se vendió/consumió en el mismo período. Consistente: las ventas+consumos alcanzan o superan lo desaparecido, explica la baja. Revisar: desapareció más de lo que se vendió o consumió — puede ser merma sin registrar, robo o un conteo mal cargado.";

type FilaLote = Awaited<ReturnType<typeof obtenerReporteVencimientosDatos>>["proximosAVencer"][number];
type FilaConciliacion = Awaited<ReturnType<typeof obtenerReporteVencimientosDatos>>["conciliacion"][number];

const COLUMNAS_LOTES: ColumnaReporte<FilaLote>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (l) => `${l.productoCodigo} — ${l.productoNombre}`,
    render: (l) => (
      <Link href={`/reportes/historial?productoId=${l.productoId}`} className="underline">
        {l.productoCodigo} — {l.productoNombre}
      </Link>
    ),
  },
  { clave: "seccion", etiqueta: "Sección", valor: (l) => l.seccionNombre, render: (l) => l.seccionNombre },
  { clave: "vence", etiqueta: "Vence", tipoFecha: "dia", valor: (l) => l.loteVencimiento.toISOString().slice(0, 10), render: (l) => l.loteVencimiento.toISOString().slice(0, 10) },
  {
    clave: "dias",
    etiqueta: "Días",
    alinear: "derecha",
    valor: (l) => l.diasParaVencer,
    render: (l) => <span className={l.diasParaVencer < 0 ? "text-red-600" : ""}>{l.diasParaVencer}</span>,
  },
  { clave: "saldo", etiqueta: "Saldo", alinear: "derecha", valor: (l) => l.saldo, render: (l) => `${l.saldo} ${l.unidadStockNombre}` },
];

const COLUMNAS_CONCILIACION: ColumnaReporte<FilaConciliacion>[] = [
  { clave: "producto", etiqueta: "Producto", valor: (c) => c.productoNombre, render: (c) => c.productoNombre },
  { clave: "seccion", etiqueta: "Sección", valor: (c) => c.seccionNombre, render: (c) => c.seccionNombre },
  { clave: "lote", etiqueta: "Lote", tipoFecha: "dia", valor: (c) => c.loteVencimiento.toISOString().slice(0, 10), render: (c) => c.loteVencimiento.toISOString().slice(0, 10) },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (c) => c.cantidadDesaparecida, render: (c) => c.cantidadDesaparecida },
  {
    clave: "periodo",
    etiqueta: "Período",
    valor: (c) => `${c.conteoAnteriorFecha} → ${c.conteoActualFecha}`,
    render: (c) => `${c.conteoAnteriorFecha} → ${c.conteoActualFecha}`,
  },
  { clave: "ventas", etiqueta: "Ventas+consumos", alinear: "derecha", valor: (c) => c.ventasPeriodo, render: (c) => c.ventasPeriodo },
  {
    clave: "estado",
    etiqueta: "Estado",
    ayuda: AYUDA_ESTADO_CONCILIACION,
    valor: (c) => c.estado,
    render: (c) => <span className={c.estado === "revisar" ? "font-medium text-red-600" : "text-neutral-500"}>{c.estado}</span>,
  },
];

export function TablaLotesVencimiento({ filas }: { filas: FilaLote[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_LOTES}
      filas={filas}
      claveFila={(l, i) => `${l.productoId}-${l.seccionId}-${l.loteVencimiento.toISOString()}-${i}`}
      sinFilasTexto="Sin lotes próximos a vencer."
      nombreExport="vencimientos"
      ordenInicial="dias"
    />
  );
}

export function TablaConciliacionVencimientos({ filas }: { filas: FilaConciliacion[] }) {
  return (
    <TablaReporte
      columnas={COLUMNAS_CONCILIACION}
      filas={filas}
      claveFila={(c, i) => `${c.productoNombre}-${c.loteVencimiento.toISOString()}-${i}`}
      sinFilasTexto="Sin lotes para conciliar (necesita al menos dos conteos por lote consecutivos en la misma sección)."
      nombreExport="conciliacion-vencimientos"
    />
  );
}
