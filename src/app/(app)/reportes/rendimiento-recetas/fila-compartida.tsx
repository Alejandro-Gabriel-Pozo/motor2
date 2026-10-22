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
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
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
  if (pesos === null) return "text-tinta-tenue";
  if (pesos > 0) return "text-error";
  if (pesos < 0) return "text-ok-tinta";
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
            <Aviso id={idAviso} variante="error" forma="en-linea">
              ¿Calibrar el rendimiento de {productoVentaNombre} en «{sucursalNombre}»? Pasás de {cantidadActual} a {cantidadEstimada} {unidadRecetaNombre}.
            </Aviso>
            <p className="text-xs text-tinta-tenue">
              Insumo compartido por {cantidadPlatosEnPool} plato(s) · {semanasConDatos} semana(s) con datos
              {r2 !== null && ` · ajuste R² ${r2.toFixed(2)}`}.
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
            <Aviso id={idAviso} variante="error" forma="en-linea">
              ¿Volver «{productoVentaNombre}» al valor central ({cantidadActualCentral} {unidadRecetaNombre}) en «{sucursalNombre}»?
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
      <td className="px-2 py-2 first:pl-0">
        {productoVentaNombre}
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
      </td>
      <td className="px-2 py-2">{totalVendido}</td>
      <td className={`px-2 py-2 ${claseImpacto(impactoPesos)}`}>
        {impactoPesos !== null ? (
          <>
            {impactoPesos > 0 ? "+" : ""}${impactoPesos.toLocaleString("es-AR")}
          </>
        ) : (
          <span className="text-tinta-tenue">{sinCosto ? "sin costo conocido" : "—"}</span>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          {puedeCalibrar && cantidadEstimada !== null && (
            <Boton id={idUsar} variante="enlace" tamano="en-fila" aria-label={`Usar este valor para ${productoVentaNombre}`} onClick={() => setModo("usar")}>
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
