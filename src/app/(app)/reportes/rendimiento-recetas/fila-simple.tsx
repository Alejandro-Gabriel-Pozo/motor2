"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";

const AYUDA_TRIVIAL =
  "Venta directa 1:1 sin preparación (1 unidad de receta, 0% merma) — un desvío acá no puede deberse a la receta en sí. Puede ser ruido de lote de compra, o señal real de rotura/robo no cargado como Merma.";

const ETIQUETA_CONFIANZA: Record<"alta" | "media" | "baja" | "sin_datos", string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
  sin_datos: "Sin datos",
};

export interface FilaRendimientoSimpleProps {
  productoVentaId: string;
  productoVentaNombre: string;
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  totalComprado: number;
  totalVendido: number;
  semanasConDatos: number;
  confianza: "alta" | "media" | "baja" | "sin_datos";
  esTrivial: boolean;
}

function celdaDesvio(desviacionPorcentaje: number | null) {
  return (
    <td className={`px-2 py-2 ${desviacionPorcentaje !== null && Math.abs(desviacionPorcentaje) >= 10 ? "font-medium text-amber-700 dark:text-amber-600" : ""}`}>
      {desviacionPorcentaje !== null ? `${desviacionPorcentaje > 0 ? "+" : ""}${desviacionPorcentaje}%` : "—"}
    </td>
  );
}

/**
 * Una fila de "Un solo plato por insumo" (Rendimiento real de recetas). Cuando hay un valor sugerido, "Usar este valor" NUNCA
 * navega directo al editor de recetas: primero pide una confirmación explícita, EN LA MISMA FILA (colSpan, mismo patrón que el
 * modo edición de `/catalogo/recetas/[productoId]`), con el porqué a la vista — comprado, vendido, semanas con datos y
 * confianza — siempre, incluso cuando el dato es confiable. La diferencia entre un caso confiable y uno dudoso queda en esos
 * números (ej. "comprado: 0" es una alarma que el propio dato ya muestra), no en si el botón existe.
 *
 * Ese mismo contexto viaja en la URL hacia el editor de recetas, para que la advertencia siga a la vista en el punto donde el
 * cambio se guarda de verdad (ver la nota junto al campo "cantidad" en `catalogo/recetas/[productoId]/page.tsx`).
 */
export function FilaRendimientoSimple(props: FilaRendimientoSimpleProps) {
  const { productoVentaId, productoVentaNombre, insumoProductoId, insumoONombre, unidadRecetaNombre, cantidadActual, cantidadEstimada, desviacionPorcentaje, totalComprado, totalVendido, semanasConDatos, confianza, esTrivial } = props;
  const [confirmando, setConfirmando] = useState(false);
  const idAviso = useId();
  const botonUsar = useRef<HTMLButtonElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (confirmando) {
      botonCancelar.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonUsar.current?.focus();
    }
  }, [confirmando]);

  function cancelar() {
    volverAlBoton.current = true;
    setConfirmando(false);
  }

  const resumen = `${productoVentaNombre} — ${insumoONombre}`;
  const href =
    cantidadEstimada !== null
      ? `/catalogo/recetas/${productoVentaId}?editar=${insumoProductoId}&sugerido=${cantidadEstimada}` +
        `&comprado=${totalComprado}&vendido=${totalVendido}&semanas=${semanasConDatos}&confianza=${encodeURIComponent(ETIQUETA_CONFIANZA[confianza])}`
      : null;

  if (confirmando && href) {
    return (
      <tr className="border-b">
        <td colSpan={7} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <div className="flex flex-col gap-1">
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Cambiar la receta de {resumen}? Vas a pasar de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </p>
            <p className="text-xs text-neutral-500">
              Comprado: {totalComprado} · Vendido: {totalVendido} · {semanasConDatos} semana(s) con datos · Confianza: {ETIQUETA_CONFIANZA[confianza]}.
              {esTrivial && " Venta directa 1:1: el desvío puede ser ruido de comprar por lote, no necesariamente un error de receta."}
            </p>
            <div className="flex gap-3">
              <EnlaceInterno href={href} aria-describedby={idAviso} className="text-sm font-medium text-amber-700 underline dark:text-amber-600">
                Sí, ir a aplicarlo
              </EnlaceInterno>
              <button ref={botonCancelar} type="button" aria-describedby={idAviso} onClick={cancelar} className="text-sm underline">
                Cancelar
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b">
      <td className="px-2 py-2 first:pl-0">{productoVentaNombre}</td>
      <td className="px-2 py-2">
        {insumoONombre}
        {esTrivial && (
          <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
            (venta directa)
            <AyudaIcono texto={AYUDA_TRIVIAL} />{" "}
            <EnlaceInterno href={`/reportes/historial?productoId=${insumoProductoId}`} className="underline">
              Ver historial
            </EnlaceInterno>
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {cantidadActual} {unidadRecetaNombre}
      </td>
      <td className="px-2 py-2">{cantidadEstimada !== null ? `${cantidadEstimada} ${unidadRecetaNombre}` : "—"}</td>
      {celdaDesvio(desviacionPorcentaje)}
      <td className="px-2 py-2">{ETIQUETA_CONFIANZA[confianza]}</td>
      <td className="px-2 py-2">
        {href && (
          <button ref={botonUsar} type="button" aria-label={`Usar este valor para ${resumen}`} onClick={() => setConfirmando(true)} className="text-sm underline">
            Usar este valor
          </button>
        )}
      </td>
    </tr>
  );
}
