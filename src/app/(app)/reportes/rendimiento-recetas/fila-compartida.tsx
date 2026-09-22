"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";

const AYUDA_TRIVIAL =
  "Venta directa 1:1 sin preparación (1 unidad de receta, 0% merma) — un desvío acá no puede deberse a la receta en sí. Puede ser ruido de lote de compra, o señal real de rotura/robo no cargado como Merma.";

export interface FilaRendimientoCompartidaProps {
  productoVentaId: string;
  productoVentaNombre: string;
  insumoProductoId: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  cantidadPlatosEnPool: number;
  semanasConDatos: number;
  r2: number | null;
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
 * Una fila de "Insumo compartido entre varios platos". Mismo criterio que `FilaRendimientoSimple`: "Usar este valor" nunca
 * aplica directo, siempre confirma en la misma fila con el porqué a la vista. Acá el valor sale de una regresión sobre todo el
 * pool (no de comprado÷vendido de ESTE plato), así que el contexto que se muestra es la calidad del ajuste (R²) y cuántos
 * platos comparten el insumo, no comprado/vendido — esos ya se ven arriba de la tabla, por pool.
 */
export function FilaRendimientoCompartida(props: FilaRendimientoCompartidaProps) {
  const { productoVentaId, productoVentaNombre, insumoProductoId, unidadRecetaNombre, cantidadActual, cantidadEstimada, desviacionPorcentaje, cantidadPlatosEnPool, semanasConDatos, r2, esTrivial } = props;
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

  const href =
    cantidadEstimada !== null
      ? `/catalogo/recetas/${productoVentaId}?editar=${insumoProductoId}&sugerido=${cantidadEstimada}` +
        `&platos=${cantidadPlatosEnPool}&semanas=${semanasConDatos}${r2 !== null ? `&ajuste=${r2.toFixed(2)}` : ""}`
      : null;

  if (confirmando && href) {
    return (
      <tr className="border-b">
        <td colSpan={5} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <div className="flex flex-col gap-1">
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Cambiar la receta de {productoVentaNombre}? Vas a pasar de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </p>
            <p className="text-xs text-neutral-500">
              Insumo compartido por {cantidadPlatosEnPool} plato(s) · {semanasConDatos} semana(s) con datos
              {r2 !== null && ` · ajuste R² ${r2.toFixed(2)}`}.
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
      <td className="px-2 py-2 first:pl-0">
        {productoVentaNombre}
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
      <td className="px-2 py-2">
        {href && (
          <button ref={botonUsar} type="button" aria-label={`Usar este valor para ${productoVentaNombre}`} onClick={() => setConfirmando(true)} className="text-sm underline">
            Usar este valor
          </button>
        )}
      </td>
    </tr>
  );
}
