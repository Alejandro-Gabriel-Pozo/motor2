"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";
import { ETIQUETA_ROTULO, desvioEsNotable, type RotuloLinea } from "@/core/reportes/rendimiento-recetas-vistas";

/** Ver el docstring del mismo mapa en fila-simple.tsx. */
const AYUDA_ROTULO: Record<Exclude<RotuloLinea, null>, string> = {
  PRODUCTO_DE_REVENTA:
    "Venta directa 1:1 sin preparación — un desvío acá no puede deberse a la receta en sí. Puede ser ruido de comprar por lote, o señal real de rotura/robo no cargado como Merma.",
  SUBRECETA_PRODUCIDA: "Este insumo se PRODUCE (no se compra) — es una sub-receta. Acá un desvío SÍ puede ser un error de receta real: conviene revisarlo con atención.",
  PACKAGING_NO_COMESTIBLE: "Packaging o limpieza (grupo «No comestibles») — queda fuera del food cost, pero la cantidad de la receta igual se puede calibrar.",
};

function claseImpacto(pesos: number | null): string {
  if (pesos === null) return "text-neutral-500 dark:text-neutral-400";
  if (pesos > 0) return "text-red-600";
  if (pesos < 0) return "text-green-700";
  return "";
}

export interface FilaRendimientoCompartidaProps {
  productoVentaId: string;
  productoVentaNombre: string;
  insumoProductoId: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  motivoSinEstimacion: string | null;
  totalVendido: number;
  impactoPesos: number | null;
  sinCosto: boolean;
  cantidadPlatosEnPool: number;
  semanasConDatos: number;
  r2: number | null;
  rotulo: RotuloLinea;
}

/**
 * Una fila de "Insumo compartido entre varios platos". Mismo criterio que `FilaRendimientoSimple`: "Usar este valor" nunca
 * aplica directo, siempre confirma en la misma fila con el porqué a la vista. Acá el valor sale de una regresión sobre todo el
 * pool (no de comprado÷vendido de ESTE plato), así que el contexto que se muestra es la calidad del ajuste (R²) y cuántos
 * platos comparten el insumo, no comprado/vendido — esos ya se ven arriba de la tabla, por pool (Comprado/Producido/Δ stock
 * del POOL entero van en el párrafo de encabezado, en page.tsx — acá solo lo que es propio de CADA plato: vendido e impacto).
 */
export function FilaRendimientoCompartida(props: FilaRendimientoCompartidaProps) {
  const {
    productoVentaId,
    productoVentaNombre,
    insumoProductoId,
    unidadRecetaNombre,
    cantidadActual,
    cantidadEstimada,
    desviacionPorcentaje,
    motivoSinEstimacion,
    totalVendido,
    impactoPesos,
    sinCosto,
    cantidadPlatosEnPool,
    semanasConDatos,
    r2,
    rotulo,
  } = props;
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
        <td colSpan={7} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <div className="flex flex-col gap-1">
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Cambiar la receta de {productoVentaNombre}? Vas a pasar de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </p>
            <p className="text-xs text-neutral-500">
              Insumo compartido por {cantidadPlatosEnPool} plato(s) · {semanasConDatos} semana(s) con datos
              {r2 !== null && ` · ajuste R² ${r2.toFixed(2)}`}.
              {rotulo && ` ${AYUDA_ROTULO[rotulo]}`}
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
        {rotulo && (
          <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
            ({ETIQUETA_ROTULO[rotulo]})
            <AyudaIcono texto={AYUDA_ROTULO[rotulo]} />{" "}
            <EnlaceInterno href={`/reportes/historial?productoId=${insumoProductoId}`} className="underline">
              Ver historial
            </EnlaceInterno>
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {cantidadActual} {unidadRecetaNombre}
      </td>
      <td className="px-2 py-2">
        {cantidadEstimada !== null ? (
          `${cantidadEstimada} ${unidadRecetaNombre}`
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400" title={motivoSinEstimacion ?? undefined}>
            {motivoSinEstimacion ?? "—"}
          </span>
        )}
      </td>
      <td className={`px-2 py-2 ${desvioEsNotable(desviacionPorcentaje) ? "font-medium text-amber-700 dark:text-amber-600" : ""}`}>
        {desviacionPorcentaje !== null ? `${desviacionPorcentaje > 0 ? "+" : ""}${desviacionPorcentaje}%` : "—"}
      </td>
      <td className="px-2 py-2">{totalVendido}</td>
      <td className={`px-2 py-2 ${claseImpacto(impactoPesos)}`}>
        {impactoPesos !== null ? (
          <>
            {impactoPesos > 0 ? "+" : ""}${impactoPesos.toLocaleString("es-AR")}
          </>
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400">{sinCosto ? "sin costo conocido" : "—"}</span>
        )}
      </td>
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
