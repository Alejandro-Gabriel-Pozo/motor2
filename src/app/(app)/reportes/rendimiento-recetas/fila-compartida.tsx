"use client";

import { IconoDeAccion } from "@/components/iconos";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { fijarRendimientoLocal, volverAlRendimientoCentral } from "@/server/actions/catalogo/rendimiento-local";
import { ETIQUETA_ROTULO, desvioEsNotable, type RotuloLinea, type MetodoRendimiento } from "@/core/reportes/public";
// rendimiento-conciliado.ts es puro (sin @/lib/db) — importable desde un componente cliente sin arrastrar Prisma al bundle. Ver el docstring de este mapa en fila-simple.tsx.

const ETIQUETA_METODO: Record<MetodoRendimiento, string> = {
  CONTEO: "Medido (Conteo Físico)",
  COMPRAS: "Estimado (compras)",
};

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
  recetaIngredienteId: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadActualCentral: number;
  calibradoLocal: boolean;
  mermaActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  motivoSinEstimacion: string | null;
  totalVendido: number;
  impactoPesos: number | null;
  sinCosto: boolean;
  cantidadPlatosEnPool: number;
  semanasConDatos: number;
  r2: number | null;
  /** Ver el docstring del mismo campo en FilaRendimientoCompartido, rendimiento-recetas.ts — repetido en todas las filas del pool. */
  metodo: MetodoRendimiento;
  rotulo: RotuloLinea;
  sucursalId: string;
  sucursalNombre: string;
  puedeCalibrar: boolean;
}

/**
 * Una fila de "Insumo compartido entre varios platos". Mismo criterio que `FilaRendimientoSimple` (paso 7 del plan de
 * rendimiento por sucursal): "Usar este valor" calibra `fijarRendimientoLocal` de la sucursal activa, nunca navega al
 * editor central. El contexto que se muestra acá es la calidad del ajuste (R²) y cuántos platos comparten el insumo, no
 * comprado/vendido (eso va por pool en page.tsx).
 */
export function FilaRendimientoCompartida(props: FilaRendimientoCompartidaProps) {
  const {
    productoVentaNombre,
    insumoProductoId,
    recetaIngredienteId,
    unidadRecetaNombre,
    cantidadActual,
    cantidadActualCentral,
    calibradoLocal,
    mermaActual,
    cantidadEstimada,
    desviacionPorcentaje,
    motivoSinEstimacion,
    totalVendido,
    impactoPesos,
    sinCosto,
    cantidadPlatosEnPool,
    semanasConDatos,
    r2,
    metodo,
    rotulo,
    sucursalId,
    sucursalNombre,
    puedeCalibrar,
  } = props;
  const router = useRouter();
  const [modo, setModo] = useState<"usar" | "volver" | null>(null);
  const idAviso = useId();
  const botonUsar = useRef<HTMLButtonElement>(null);
  const botonVolver = useRef<HTMLButtonElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  const volverAlBotonQueAbrio = useRef<"usar" | "volver" | null>(null);

  useEffect(() => {
    if (modo) {
      botonCancelar.current?.focus();
    } else if (volverAlBotonQueAbrio.current === "usar") {
      botonUsar.current?.focus();
    } else if (volverAlBotonQueAbrio.current === "volver") {
      botonVolver.current?.focus();
    }
    volverAlBotonQueAbrio.current = null;
  }, [modo]);

  function cancelar() {
    volverAlBotonQueAbrio.current = modo;
    setModo(null);
  }

  if (modo === "usar" && cantidadEstimada !== null) {
    return (
      <tr className="border-b">
        <td colSpan={7} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <FormConResultado
            accion={async (formData) => {
              const cantidad = Number(formData.get("cantidad"));
              const mermaPorcentaje = Number(formData.get("mermaPorcentaje") || 0);
              const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad, mermaPorcentaje }, {
                tipo: "sugerencia_pool",
                sucursalCalculoId: sucursalId,
                sugerido: cantidadEstimada,
                platos: cantidadPlatosEnPool,
                semanas: semanasConDatos,
                ajusteR2: r2 ?? undefined,
              });
              if (r.ok) {
                setModo(null);
                router.refresh();
              }
              return r;
            }}
            className="flex flex-col gap-2"
          >
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Calibrar el rendimiento de {productoVentaNombre} en «{sucursalNombre}»? Pasás de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </p>
            <p className="text-xs text-neutral-500">
              Insumo compartido por {cantidadPlatosEnPool} plato(s) · {semanasConDatos} semana(s) con datos
              {r2 !== null && ` · ajuste R² ${r2.toFixed(2)}`}.
              {rotulo && ` ${AYUDA_ROTULO[rotulo]}`}
            </p>
            <p className="text-xs text-neutral-500">
              Esto cambia solo el rendimiento de «{sucursalNombre}». La receta central ({cantidadActualCentral} {unidadRecetaNombre}) y las otras
              sucursales no se tocan.{" "}
              <EnlaceInterno href="/reportes/rendimiento-recetas/por-sucursal" className="underline">
                Comparar con otras sucursales
              </EnlaceInterno>
              .
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">
                Cantidad
                <CampoNumero name="cantidad" defaultValue={String(cantidadEstimada)} required className="w-28" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Merma %
                <CampoNumero name="mermaPorcentaje" defaultValue={String(mermaActual)} className="w-24" />
              </label>
              <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
                Guardar como rendimiento de «{sucursalNombre}»
              </button>
              <button ref={botonCancelar} type="button" onClick={cancelar} className="text-sm underline">
                Cancelar
              </button>
            </div>
          </FormConResultado>
        </td>
      </tr>
    );
  }

  if (modo === "volver") {
    return (
      <tr className="border-b">
        <td colSpan={7} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <FormConResultado
            accion={async () => {
              const r = await volverAlRendimientoCentral(recetaIngredienteId);
              if (r.ok) {
                setModo(null);
                router.refresh();
              }
              return r;
            }}
            className="flex flex-col gap-1"
          >
            <p id={idAviso} role="alert" className="text-sm text-amber-700 dark:text-amber-600">
              ¿Volver «{productoVentaNombre}» al valor central ({cantidadActualCentral} {unidadRecetaNombre}) en «{sucursalNombre}»?
            </p>
            <div className="flex gap-3">
              <button type="submit" className="text-sm font-medium text-amber-700 underline dark:text-amber-600" aria-describedby={idAviso}>
                Sí, volver al valor central
              </button>
              <button ref={botonCancelar} type="button" onClick={cancelar} className="text-sm underline">
                Cancelar
              </button>
            </div>
          </FormConResultado>
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
            <EnlaceInterno href={`/reportes/historial?productoId=${insumoProductoId}`} className="underline inline-flex items-center gap-1">
              <IconoDeAccion id="historial" />
              Ver historial
            </EnlaceInterno>
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {cantidadActual} {unidadRecetaNombre}
        {calibradoLocal && (
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            (calibrado acá; central: {cantidadActualCentral} {unidadRecetaNombre})
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {cantidadEstimada !== null ? (
          `${cantidadEstimada} ${unidadRecetaNombre}`
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400" title={motivoSinEstimacion ?? undefined}>
            {motivoSinEstimacion ?? "—"}
          </span>
        )}
        <span className="block text-xs text-neutral-500 dark:text-neutral-400">{ETIQUETA_METODO[metodo]}</span>
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
        <div className="flex flex-col gap-1">
          {puedeCalibrar && cantidadEstimada !== null && (
            <button ref={botonUsar} type="button" aria-label={`Usar este valor para ${productoVentaNombre}`} onClick={() => setModo("usar")} className="text-sm underline">
              Usar este valor
            </button>
          )}
          {puedeCalibrar && calibradoLocal && (
            <button ref={botonVolver} type="button" onClick={() => setModo("volver")} className="text-sm underline">
              Volver al valor central
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
