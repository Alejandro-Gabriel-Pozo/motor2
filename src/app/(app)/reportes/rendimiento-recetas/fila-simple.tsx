"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";
import { ETIQUETA_ROTULO, desvioEsNotable, explicarConfianza, type Confianza, type RotuloLinea } from "@/core/reportes/rendimiento-recetas-vistas";

/** Ayuda por tipo de rótulo — reemplaza el AYUDA_TRIVIAL único (§3, plan P7): cada uno explica algo distinto sobre por qué el desvío se lee diferente acá. */
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

export interface FilaRendimientoSimpleProps {
  productoVentaId: string;
  productoVentaNombre: string;
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  motivoSinEstimacion: string | null;
  totalComprado: number;
  totalProducido: number;
  totalVendido: number;
  stockApertura: number;
  stockCierre: number;
  bandaRuidoPct: number | null;
  impactoPesos: number | null;
  sinCosto: boolean;
  semanasConDatos: number;
  confianza: Confianza;
  rotulo: RotuloLinea;
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
  const {
    productoVentaId,
    productoVentaNombre,
    insumoProductoId,
    insumoONombre,
    unidadRecetaNombre,
    cantidadActual,
    cantidadEstimada,
    desviacionPorcentaje,
    motivoSinEstimacion,
    totalComprado,
    totalProducido,
    totalVendido,
    stockApertura,
    stockCierre,
    bandaRuidoPct,
    impactoPesos,
    sinCosto,
    semanasConDatos,
    confianza,
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

  const resumen = `${productoVentaNombre} — ${insumoONombre}`;
  // comprado/vendido/semanas/confianza acá siguen siendo los de SIEMPRE (no totalEntradas) — es el contexto que ya lee catalogo/recetas/[productoId]/page.tsx, sin tocar esa pantalla.
  const href =
    cantidadEstimada !== null
      ? `/catalogo/recetas/${productoVentaId}?editar=${insumoProductoId}&sugerido=${cantidadEstimada}` +
        `&comprado=${totalComprado}&vendido=${totalVendido}&semanas=${semanasConDatos}&confianza=${encodeURIComponent(explicarConfianza(confianza, semanasConDatos))}`
      : null;

  if (confirmando && href) {
    return (
      <tr className="border-b">
        <td colSpan={11} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <div className="flex flex-col gap-1">
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Cambiar la receta de {resumen}? Vas a pasar de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </p>
            <p className="text-xs text-neutral-500">
              Comprado: {totalComprado}
              {totalProducido > 0 && ` (+${totalProducido} producido)`} · Vendido: {totalVendido} · Confianza: {explicarConfianza(confianza, semanasConDatos)}.
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
      <td className="px-2 py-2 first:pl-0">{productoVentaNombre}</td>
      <td className="px-2 py-2">
        {insumoONombre}
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
        {bandaRuidoPct !== null && (
          <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
            ±{bandaRuidoPct}% de ruido esperable por comprar de a lotes{Math.abs(desviacionPorcentaje ?? 0) <= bandaRuidoPct && " — el desvío cae dentro de esa banda"}
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {totalComprado}
        {totalProducido > 0 && <span className="text-xs text-neutral-500 dark:text-neutral-400"> (+{totalProducido} producido)</span>}
      </td>
      <td className="px-2 py-2">{totalVendido}</td>
      <td className="px-2 py-2" title={`Antes de este rango: ${stockApertura} — después: ${stockCierre}`}>
        {stockCierre - stockApertura > 0 ? "+" : ""}
        {redondearParaMostrar(stockCierre - stockApertura)}
      </td>
      <td className={`px-2 py-2 ${claseImpacto(impactoPesos)}`}>
        {impactoPesos !== null ? (
          <>
            {impactoPesos > 0 ? "+" : ""}${impactoPesos.toLocaleString("es-AR")}
          </>
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400">{sinCosto ? "sin costo conocido" : "—"}</span>
        )}
      </td>
      <td className="px-2 py-2">{explicarConfianza(confianza, semanasConDatos)}</td>
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

/** Evita que un −0 (redondeo de punto flotante en una resta que da 0) se muestre como "-0". */
function redondearParaMostrar(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}
