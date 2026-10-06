"use client";

import { IconoDeAccion } from "@/components/iconos";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { EventoHistorialProducto } from "@/core/reportes/historial-producto";
import { EnlaceInterno } from "@/components/enlace-interno";

/** Mismo texto/estilo que la marca "Anulada" de /reportes/compras (page.tsx) — una compra o venta anulada no ocurrió, esto lo deja a la vista en vez de verse como un "movimiento fantasma". */
function MarcaAnulada() {
  return (
    <span className="ml-1 rounded border border-red-600 px-1.5 text-xs text-red-600" title="Esta operación está anulada: el contra-asiento de al lado la revierte.">
      Anulada
    </span>
  );
}

/** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md), mismo criterio que tabla-trazabilidad.tsx — texto, no solo color. */
function MarcaSustituto({ nombrePrincipal }: { nombrePrincipal: string }) {
  return <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-600">Sustituto de «{nombrePrincipal}»</span>;
}

function columnas(mostrarSaldo: boolean): ColumnaReporte<EventoHistorialProducto>[] {
  const base: ColumnaReporte<EventoHistorialProducto>[] = [
    { clave: "fecha", etiqueta: "Fecha", tipoFecha: "dia", valor: (ev) => ev.fecha.toISOString().slice(0, 10), render: (ev) => ev.fecha.toISOString().slice(0, 10) },
    { clave: "tipo", etiqueta: "Tipo", valor: (ev) => (ev.tipo === "movimiento" ? (ev.proceso ?? "") : "Conteo"), render: (ev) => (ev.tipo === "movimiento" ? ev.proceso : "Conteo") },
    {
      clave: "detalle",
      etiqueta: "Detalle",
      valor: (ev) => ev.detalle,
      render: (ev) => (
        <>
          {ev.detalle}
          {ev.tipo === "movimiento" && ev.anulada && <MarcaAnulada />}
          {ev.tipo === "movimiento" && ev.sustituyeANombre && <MarcaSustituto nombrePrincipal={ev.sustituyeANombre} />}
        </>
      ),
    },
    { clave: "seccion", etiqueta: "Sección", valor: (ev) => ev.seccionNombre, render: (ev) => ev.seccionNombre },
    {
      clave: "cantidad",
      etiqueta: "Cantidad",
      alinear: "derecha",
      valor: (ev) => (ev.tipo === "movimiento" ? (ev.cantidadConSigno ?? 0) : (ev.conteoReal ?? 0)),
      render: (ev) => (ev.tipo === "movimiento" ? ev.cantidadConSigno : `${ev.conteoReal} (dif. ${ev.diferencia})`),
    },
  ];
  if (mostrarSaldo) {
    base.push({
      clave: "saldo",
      etiqueta: "Saldo corriente",
      alinear: "derecha",
      valor: (ev) => (ev.tipo === "movimiento" ? (ev.saldoCorriente ?? null) : null),
      render: (ev) => (ev.tipo === "movimiento" ? ev.saldoCorriente : "—"),
    });
  }
  base.push({
    // Sin `valor`: columna fija, no ordena y queda fuera del Excel (es un link, no un dato — mismo criterio documentado en ColumnaReporte.valor).
    clave: "origen",
    etiqueta: "Origen",
    render: (ev) =>
      ev.tipo === "movimiento" && ev.idOperacion ? (
        // /reportes/trazabilidad tiene su propia clave (reporte_trazabilidad): EnlaceInterno deja el texto sin enlace si el rol no la tiene (test/arquitectura/enlaces-con-permiso.test.ts).
        <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(ev.idOperacion)}`} className="underline inline-flex items-center gap-1">
          <IconoDeAccion id="ver" />
          Ver operación
        </EnlaceInterno>
      ) : null,
  });
  return base;
}

export function TablaHistorialEventos({ filas, nombreExport, mostrarSaldo = true }: { filas: EventoHistorialProducto[]; nombreExport: string; mostrarSaldo?: boolean }) {
  return (
    <TablaReporte
      columnas={columnas(mostrarSaldo)}
      filas={filas}
      claveFila={(ev, i) => `${ev.fecha.toISOString()}-${i}`}
      sinFilasTexto="Sin eventos en el rango elegido."
      nombreExport={nombreExport}
    />
  );
}
