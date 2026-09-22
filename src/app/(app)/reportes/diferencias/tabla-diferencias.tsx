"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaReporte, type ColumnaReporte } from "@/components/tabla-reporte";
import type { FilaDiferenciaAjuste } from "@/core/reportes/diferencias-ajustes";

const LABEL_ESTADO: Record<string, string> = { REVISAR: "Revisar", ESPERADO: "Esperado", OK: "OK" };

const AYUDA_RECETAS =
  "Un Ajuste/Conteo en una MP que solo se consume por receta (nunca es esperable un Ajuste manual real) es una señal para recalibrar la Merma % de la receta, no necesariamente un error a corregir a mano. Neto negativo (se perdió más de lo que la receta preveía): conviene subir la Merma %. Neto positivo (sobró más de lo previsto): conviene bajarla. No es un número exacto — si el insumo aparece en varias recetas, la magnitud no se puede atribuir a una sola sin prorratear.";

const AYUDA_PROXIMO_CONTEO =
  "Según la agenda configurada en Frecuencia de conteo (sub-plan de conteos físicos periódicos). Sin agenda, esta pantalla no lo marca como pendiente — no es un chequeo de stock (para eso está Stock → Alertas), es higiene de control.";

function celdaProximoConteo(f: FilaDiferenciaAjuste) {
  if (f.conteoVencido) {
    return (
      <span className="font-medium text-red-600">
        {f.proximaFechaConteo ? `Vencido desde ${f.proximaFechaConteo.toISOString().slice(0, 10)}` : "Nunca se contó (con agenda activa)"}
      </span>
    );
  }
  if (f.proximaFechaConteo) return <span>{f.proximaFechaConteo.toISOString().slice(0, 10)}</span>;
  return (
    <EnlaceInterno href={`/stock/conteo-frecuencia?sugerido=${f.productoId}&sugeridoNombre=${encodeURIComponent(f.producto)}`} className="text-xs text-neutral-500 underline">
      Sin agenda — configurar
    </EnlaceInterno>
  );
}

const COLUMNAS: ColumnaReporte<FilaDiferenciaAjuste>[] = [
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
  { clave: "grupo", etiqueta: "Grupo", valor: (f) => f.grupoTexto, render: (f) => f.grupoTexto },
  { clave: "sumaAjustes", etiqueta: "Suma ajustes", alinear: "derecha", valor: (f) => f.sumaAjustesManuales, render: (f) => f.sumaAjustesManuales },
  {
    clave: "ultimoAjuste",
    etiqueta: "Último ajuste",
    tipoFecha: "dia",
    valor: (f) => (f.ultimaFechaAjuste ? f.ultimaFechaAjuste.toISOString().slice(0, 10) : ""),
    render: (f) => (f.ultimaFechaAjuste ? f.ultimaFechaAjuste.toISOString().slice(0, 10) : "—"),
  },
  { clave: "sumaConteos", etiqueta: "Suma conteos", alinear: "derecha", valor: (f) => f.sumaConteosFisicos, render: (f) => f.sumaConteosFisicos },
  {
    clave: "ultimoConteo",
    etiqueta: "Último conteo",
    tipoFecha: "dia",
    valor: (f) => (f.ultimaFechaConteo ? f.ultimaFechaConteo.toISOString().slice(0, 10) : ""),
    render: (f) => (f.ultimaFechaConteo ? f.ultimaFechaConteo.toISOString().slice(0, 10) : "—"),
  },
  {
    clave: "proximoConteo",
    etiqueta: "Próximo conteo",
    ayuda: AYUDA_PROXIMO_CONTEO,
    valor: (f) => (f.conteoVencido ? "Vencido" : f.proximaFechaConteo ? f.proximaFechaConteo.toISOString().slice(0, 10) : ""),
    render: (f) => celdaProximoConteo(f),
  },
  {
    clave: "estado",
    etiqueta: "Estado",
    valor: (f) => LABEL_ESTADO[f.estado],
    render: (f) => <span className={f.estado === "REVISAR" ? "font-medium text-red-600" : f.estado === "ESPERADO" ? "text-amber-700 dark:text-amber-600" : ""}>{LABEL_ESTADO[f.estado]}</span>,
  },
  {
    clave: "recetas",
    etiqueta: "Recetas que lo usan",
    ayuda: AYUDA_RECETAS,
    valor: (f) => (f.recetasQueLoUsan.length ? f.recetasQueLoUsan.map((r) => `${r.productoVentaNombre} (${r.mermaPorcentajeActual}%)`).join("; ") : null),
    render: (f) =>
      f.recetasQueLoUsan.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {f.recetasQueLoUsan.map((r) => (
            <span key={r.productoVentaId}>
              <EnlaceInterno href={`/catalogo/recetas/${r.productoVentaId}?editar=${f.productoId}`} className="underline">
                {r.productoVentaNombre} (merma {r.mermaPorcentajeActual}%)
              </EnlaceInterno>{" "}
              ·{" "}
              <EnlaceInterno href={`/reportes/rendimiento-recetas?productoId=${r.productoVentaId}`} className="text-xs underline">
                ver rendimiento
              </EnlaceInterno>
            </span>
          ))}
          {f.sugerenciaMerma && (
            <span className={f.sugerenciaMerma === "aumentar" ? "text-xs font-medium text-red-600" : "text-xs font-medium text-amber-700 dark:text-amber-600"}>
              Sugerencia: {f.sugerenciaMerma === "aumentar" ? "subir" : "bajar"} la merma %
            </span>
          )}
        </div>
      ) : (
        "—"
      ),
  },
];

export function TablaDiferenciasAjuste({ filas }: { filas: FilaDiferenciaAjuste[] }) {
  return (
    <TablaReporte columnas={COLUMNAS} filas={filas} claveFila={(f) => f.productoId} sinFilasTexto="Sin materias primas cargadas." nombreExport="diferencias-ajuste" />
  );
}
