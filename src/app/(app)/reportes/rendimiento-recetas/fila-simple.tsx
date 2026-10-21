"use client";

import { IconoDeAccion } from "@/components/iconos";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AyudaIcono } from "@/components/ayuda-campo";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { fijarRendimientoLocal, volverAlRendimientoCentral } from "@/server/actions/catalogo/rendimiento-local";
import { ETIQUETA_ROTULO, desvioEsNotable, explicarConfianza, type Confianza, type RotuloLinea, type MetodoRendimiento } from "@/core/reportes/public";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
// rendimiento-conciliado.ts es puro (sin @/lib/db, ver su propio docstring) — importable desde un componente cliente sin arrastrar Prisma al bundle.

/** Mismo criterio de "fecha corta" que compras/page.tsx (`fechaCorta`) — YYYY-MM-DD, no se reinventa un formato nuevo acá. */
const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);

const ETIQUETA_METODO: Record<MetodoRendimiento, string> = {
  CONTEO: "Medido (Conteo Físico)",
  COMPRAS: "Estimado (compras)",
};

/** Ayuda por tipo de rótulo — reemplaza el AYUDA_TRIVIAL único (§3, plan P7): cada uno explica algo distinto sobre por qué el desvío se lee diferente acá. */
const AYUDA_ROTULO: Record<Exclude<RotuloLinea, null>, string> = {
  PRODUCTO_DE_REVENTA:
    "Venta directa 1:1 sin preparación — un desvío acá no puede deberse a la receta en sí. Puede ser ruido de comprar por lote, o señal real de rotura/robo no cargado como Merma.",
  SUBRECETA_PRODUCIDA: "Este insumo se PRODUCE (no se compra) — es una sub-receta. Acá un desvío SÍ puede ser un error de receta real: conviene revisarlo con atención.",
  PACKAGING_NO_COMESTIBLE: "Packaging o limpieza (grupo «No comestibles») — queda fuera del food cost, pero la cantidad de la receta igual se puede calibrar.",
};

function claseImpacto(pesos: number | null): string {
  if (pesos === null) return "text-tinta-tenue";
  if (pesos > 0) return "text-error";
  if (pesos < 0) return "text-ok-tinta";
  return "";
}

export interface FilaRendimientoSimpleProps {
  productoVentaId: string;
  productoVentaNombre: string;
  insumoProductoId: string;
  insumoONombre: string;
  recetaIngredienteId: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadActualCentral: number;
  calibradoLocal: boolean;
  mermaActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  motivoSinEstimacion: string | null;
  totalComprado: number;
  totalProducido: number;
  totalVendido: number;
  stockApertura: number;
  stockCierre: number;
  /** "CONTEO" (medido) o "COMPRAS" (estimado, D4) — ver el docstring del mismo campo en FilaRendimientoSimple, rendimiento-recetas.ts. */
  metodo: MetodoRendimiento;
  anclaDesde: Date | null;
  anclaHasta: Date | null;
  consumoReal: number | null;
  bandaRuidoPct: number | null;
  impactoPesos: number | null;
  sinCosto: boolean;
  semanasConDatos: number;
  confianza: Confianza;
  rotulo: RotuloLinea;
  sucursalId: string;
  sucursalNombre: string;
  /** true si el usuario activo puede calibrar (`calibrar_rendimiento_local`, Ver+Editar) en esta sucursal. */
  puedeCalibrar: boolean;
}

/**
 * Una fila de "Un solo plato por insumo" (Rendimiento real de recetas). Rendimiento por sucursal (docs/plan-rendimiento-
 * receta-por-sucursal-2026-09-26.md, paso 7): "Usar este valor" ya NO navega al editor de la receta central — pide
 * confirmación EN LA MISMA FILA (colSpan, mismo patrón que antes) con el porqué a la vista, y calibra el rendimiento de LA
 * SUCURSAL ACTIVA (`fijarRendimientoLocal`), nunca la receta central. La merma se congela junto con la cantidad (D4,
 * decisión del dueño): el formulario trae los dos campos editables, con la cantidad estimada y la merma EFECTIVA usada en
 * el cálculo como default.
 */
export function FilaRendimientoSimple(props: FilaRendimientoSimpleProps) {
  const {
    productoVentaNombre,
    insumoProductoId,
    insumoONombre,
    recetaIngredienteId,
    unidadRecetaNombre,
    cantidadActual,
    cantidadActualCentral,
    calibradoLocal,
    mermaActual,
    cantidadEstimada,
    desviacionPorcentaje,
    motivoSinEstimacion,
    totalComprado,
    totalProducido,
    totalVendido,
    stockApertura,
    stockCierre,
    metodo,
    anclaDesde,
    anclaHasta,
    bandaRuidoPct,
    impactoPesos,
    sinCosto,
    semanasConDatos,
    confianza,
    rotulo,
    sucursalId,
    sucursalNombre,
    puedeCalibrar,
  } = props;
  const router = useRouter();
  const [modo, setModo] = useState<"usar" | "volver" | null>(null);
  const idAviso = useId();
  // `Boton` no recibe `ref` (su tipo es el de los atributos del botón): el foco se maneja por `id`.
  const idUsar = `${idAviso}-usar`;
  const idVolver = `${idAviso}-volver`;
  const idCancelar = `${idAviso}-cancelar`;
  const volverAlBotonQueAbrio = useRef<"usar" | "volver" | null>(null);

  useEffect(() => {
    if (modo) {
      document.getElementById(idCancelar)?.focus();
    } else if (volverAlBotonQueAbrio.current === "usar") {
      document.getElementById(idUsar)?.focus();
    } else if (volverAlBotonQueAbrio.current === "volver") {
      document.getElementById(idVolver)?.focus();
    }
    volverAlBotonQueAbrio.current = null;
  }, [modo, idCancelar, idUsar, idVolver]);

  function cancelar() {
    volverAlBotonQueAbrio.current = modo;
    setModo(null);
  }

  const resumen = `${productoVentaNombre} — ${insumoONombre}`;

  if (modo === "usar" && cantidadEstimada !== null) {
    return (
      <tr className="border-b">
        <td colSpan={11} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
          <FormConResultado
            accion={async (formData) => {
              const cantidad = Number(formData.get("cantidad"));
              const mermaPorcentaje = Number(formData.get("mermaPorcentaje") || 0);
              const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad, mermaPorcentaje }, {
                tipo: "sugerencia_simple",
                sucursalCalculoId: sucursalId,
                sugerido: cantidadEstimada,
                comprado: totalComprado,
                vendido: totalVendido,
                semanas: semanasConDatos,
                confianza: explicarConfianza(confianza, semanasConDatos),
              });
              if (r.ok) {
                setModo(null);
                router.refresh();
              }
              return r;
            }}
            className="flex flex-col gap-2"
          >
            <Aviso id={idAviso} variante="error" forma="en-linea">
              ¿Calibrar el rendimiento de {resumen} en «{sucursalNombre}»? Pasás de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </Aviso>
            <p className="text-xs text-tinta-tenue">
              Comprado: {totalComprado}
              {totalProducido > 0 && ` (+${totalProducido} producido)`} · Vendido: {totalVendido} · Confianza: {explicarConfianza(confianza, semanasConDatos)}.
              {rotulo && ` ${AYUDA_ROTULO[rotulo]}`}
            </p>
            <p className="text-xs text-tinta-tenue">
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
              <Boton type="submit" tamano="compacto">
                Guardar como rendimiento de «{sucursalNombre}»
              </Boton>
              <Boton id={idCancelar} variante="enlace" tamano="en-fila" onClick={cancelar}>
                Cancelar
              </Boton>
            </div>
          </FormConResultado>
        </td>
      </tr>
    );
  }

  if (modo === "volver") {
    return (
      <tr className="border-b">
        <td colSpan={11} className="px-2 py-2" onKeyDown={(e) => e.key === "Escape" && cancelar()}>
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
            <Aviso id={idAviso} variante="error" forma="en-linea">
              ¿Volver «{insumoONombre}» en «{productoVentaNombre}» al valor central ({cantidadActualCentral} {unidadRecetaNombre}) en «{sucursalNombre}»?
            </Aviso>
            <div className="flex gap-3">
              <Boton type="submit" variante="enlace-peligro" tamano="en-fila" aria-describedby={idAviso}>
                Sí, volver al valor central
              </Boton>
              <Boton id={idCancelar} variante="enlace" tamano="en-fila" onClick={cancelar}>
                Cancelar
              </Boton>
            </div>
          </FormConResultado>
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
          <span className="ml-1 text-xs text-tinta-tenue">
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
          <span className="block text-xs text-tinta-tenue">
            (calibrado acá; central: {cantidadActualCentral} {unidadRecetaNombre})
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {cantidadEstimada !== null ? (
          `${cantidadEstimada} ${unidadRecetaNombre}`
        ) : (
          <span className="text-tinta-tenue" title={motivoSinEstimacion ?? undefined}>
            {motivoSinEstimacion ?? "—"}
          </span>
        )}
        <span className="block text-xs text-tinta-tenue">{ETIQUETA_METODO[metodo]}</span>
      </td>
      <td className={`px-2 py-2 ${desvioEsNotable(desviacionPorcentaje) ? "font-medium text-aviso-tinta" : ""}`}>
        {desviacionPorcentaje !== null ? `${desviacionPorcentaje > 0 ? "+" : ""}${desviacionPorcentaje}%` : "—"}
        {bandaRuidoPct !== null && (
          <span className="block text-xs font-normal text-tinta-tenue">
            ±{bandaRuidoPct}% de ruido esperable por comprar de a lotes{Math.abs(desviacionPorcentaje ?? 0) <= bandaRuidoPct && " — el desvío cae dentro de esa banda"}
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        {totalComprado}
        {totalProducido > 0 && <span className="text-xs text-tinta-tenue"> (+{totalProducido} producido)</span>}
      </td>
      <td className="px-2 py-2">{totalVendido}</td>
      {metodo === "CONTEO" && anclaDesde && anclaHasta ? (
        <td className="px-2 py-2" title="El consumo de esta fila se midió DIRECTO entre estas dos fechas, no con Δ stock — ver la fórmula (icono de ayuda de Rendimiento real).">
          contado {fechaCorta(anclaDesde)} → {fechaCorta(anclaHasta)}
        </td>
      ) : (
        <td className="px-2 py-2" title={`Antes de este rango: ${stockApertura} — después: ${stockCierre}`}>
          {stockCierre - stockApertura > 0 ? "+" : ""}
          {redondearParaMostrar(stockCierre - stockApertura)}
          <EnlaceInterno href="/movimientos/conteo-fisico" className="block text-xs underline">
            Programá un conteo
          </EnlaceInterno>
        </td>
      )}
      <td className={`px-2 py-2 ${claseImpacto(impactoPesos)}`}>
        {impactoPesos !== null ? (
          <>
            {impactoPesos > 0 ? "+" : ""}${impactoPesos.toLocaleString("es-AR")}
          </>
        ) : (
          <span className="text-tinta-tenue">{sinCosto ? "sin costo conocido" : "—"}</span>
        )}
      </td>
      <td className="px-2 py-2">{explicarConfianza(confianza, semanasConDatos)}</td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          {puedeCalibrar && cantidadEstimada !== null && (
            <Boton id={idUsar} variante="enlace" tamano="en-fila" aria-label={`Usar este valor para ${resumen}`} onClick={() => setModo("usar")}>
              Usar este valor
            </Boton>
          )}
          {puedeCalibrar && calibradoLocal && (
            <Boton id={idVolver} variante="enlace" tamano="en-fila" onClick={() => setModo("volver")}>
              Volver al valor central
            </Boton>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Evita que un −0 (redondeo de punto flotante en una resta que da 0) se muestre como "-0". */
function redondearParaMostrar(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}
