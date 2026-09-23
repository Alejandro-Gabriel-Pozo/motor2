"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFrecuenciaConteo } from "@/server/actions/stock/frecuencia-conteo";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";

export interface FilaFrecuenciaConteoEnEdicion {
  productoId: string;
  productoEtiqueta: string;
  frecuenciaDias: string;
}

/** Mismo molde que StockMinimoForm (stock/minimo/stock-minimo-form.tsx) — es el template exacto de "algo configurable por sucursal × producto con alta/baja" (plan S5). */
export function ConteoFrecuenciaForm({
  filaEnEdicion,
  productoIdSugerido,
  productoEtiquetaSugerida,
}: {
  filaEnEdicion?: FilaFrecuenciaConteoEnEdicion;
  /** Prellenado al hacer clic en "Agendar semanal" de una sugerencia de clase A (S4) — nunca se aplica solo, siempre pasa por este mismo formulario. */
  productoIdSugerido?: string;
  productoEtiquetaSugerida?: string;
}) {
  const router = useRouter();
  const editando = Boolean(filaEnEdicion);
  const [productoId, setProductoId] = useState(filaEnEdicion?.productoId ?? productoIdSugerido ?? "");
  const [frecuenciaDias, setFrecuenciaDias] = useState(filaEnEdicion?.frecuenciaDias ?? (productoIdSugerido ? "7" : ""));
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setFrecuenciaConteo(productoId, Number(frecuenciaDias));
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          if (resultado.ok) {
            if (editando) {
              router.push("/stock/conteo-frecuencia");
            } else {
              setProductoId("");
              setFrecuenciaDias("");
              setResetCount((n) => n + 1);
            }
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">{editando ? "Editar frecuencia de conteo" : "Agendar un conteo periódico"}</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto
          value={productoId}
          onChange={setProductoId}
          filtro={{ soloDisponibles: true }}
          etiquetaInicial={filaEnEdicion?.productoEtiqueta ?? productoEtiquetaSugerida}
          limpiarSenal={resetCount}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Cada cuántos días (0 = desactivada)
        <CampoNumero value={frecuenciaDias} onChange={setFrecuenciaDias} required />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
