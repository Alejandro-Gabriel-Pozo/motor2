"use client";

import { IconoDeAccion } from "@/components/iconos";
import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import { enlaceParaCorregirMovimiento, type OperacionEncontrada, type ItemOperacion } from "@/core/reportes/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

/** El día de calendario de un instante en hora argentina (P1): `Operacion.fecha` es un instante; leerlo en UTC mostraba el día siguiente a partir de las 21:00. */
const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);

const COLUMNAS_ENCONTRADAS: ColumnaReporte<OperacionEncontrada>[] = [
  { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (e) => dia(e.fecha), render: (e) => dia(e.fecha) },
  { clave: "proceso", etiqueta: "Proceso", valor: (e) => e.proceso, render: (e) => e.proceso },
  { clave: "seccion", etiqueta: "Sección", valor: (e) => e.seccionNombre, render: (e) => e.seccionNombre },
  {
    clave: "ver",
    etiqueta: "",
    render: (e) => (
      <Link href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(e.idOperacion)}`} className="underline inline-flex items-center gap-1">
        <IconoDeAccion id="ver" />
        Ver operación
      </Link>
    ),
  },
];

/** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): tercera capa de trazabilidad, más visible que el detalle — texto, no
 * solo color, para que sea legible sin depender del contraste (mismo criterio que `MarcaAnulada` de tabla-historial.tsx). */
function MarcaSustituto({ nombrePrincipal }: { nombrePrincipal: string }) {
  return <span className="ml-1 text-xs font-medium text-aviso-tinta">Sustituto de «{nombrePrincipal}»</span>;
}

const COLUMNAS_ITEMS: ColumnaReporte<ItemOperacion>[] = [
  {
    clave: "producto",
    etiqueta: "Producto",
    valor: (it) => `${it.productoCodigo} — ${it.productoNombre}`,
    render: (it) => (
      <>
        {it.productoCodigo} — {it.productoNombre}
        {it.sustituyeANombre && <MarcaSustituto nombrePrincipal={it.sustituyeANombre} />}
      </>
    ),
  },
  { clave: "proceso", etiqueta: "Proceso", valor: (it) => it.proceso, render: (it) => it.proceso },
  { clave: "seccion", etiqueta: "Sección", valor: (it) => it.seccionNombre, render: (it) => it.seccionNombre },
  { clave: "cantidad", etiqueta: "Cantidad", alinear: "derecha", valor: (it) => it.cantidad, render: (it) => it.cantidad },
  { clave: "detalle", etiqueta: "Detalle", valor: (it) => it.detalle, render: (it) => it.detalle },
];

export function TablaOperacionesEncontradas({ filas }: { filas: OperacionEncontrada[] }) {
  return <TablaReporte columnas={COLUMNAS_ENCONTRADAS} filas={filas} claveFila={(e) => e.idOperacion} />;
}

/** E0 (g): una columna más, SOLO para quien puede cargar un Ajuste (`puedeCorregir`): «Corregir este movimiento» abre el Ajuste prellenado con el producto, la sección y la referencia al original. El original no se toca. */
const COLUMNA_CORREGIR: ColumnaReporte<ItemOperacion> = {
  clave: "corregir",
  etiqueta: "",
  render: (it) => (
    <EnlaceInterno href={enlaceParaCorregirMovimiento(it.idMovimiento)} className="underline inline-flex items-center gap-1" aria-label={`Corregir este movimiento de ${it.productoNombre}`}>
      Corregir este movimiento
    </EnlaceInterno>
  ),
};

export function TablaItemsOperacion({ filas, nombreExport, puedeCorregir = false }: { filas: ItemOperacion[]; nombreExport: string; puedeCorregir?: boolean }) {
  return <TablaReporte columnas={puedeCorregir ? [...COLUMNAS_ITEMS, COLUMNA_CORREGIR] : COLUMNAS_ITEMS} filas={filas} claveFila={(it) => it.idMovimiento} nombreExport={nombreExport} />;
}
