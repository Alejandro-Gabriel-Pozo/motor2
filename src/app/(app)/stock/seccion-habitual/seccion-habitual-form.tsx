"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { setSeccionHabitual } from "@/server/actions/stock/seccion-habitual";
import { SelectorProducto } from "@/components/selector-producto";

export interface FilaSeccionHabitualEnEdicion {
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
}

/** Mismo molde que StockMinimoForm (stock/minimo/stock-minimo-form.tsx): alta, o edición de una fila existente sin rebuscar el producto. */
export function SeccionHabitualForm({ secciones, filaEnEdicion }: { secciones: { id: string; nombre: string }[]; filaEnEdicion?: FilaSeccionHabitualEnEdicion }) {
  const router = useRouter();
  const editando = Boolean(filaEnEdicion);
  const [productoId, setProductoId] = useState(filaEnEdicion?.productoId ?? "");
  const [seccionId, setSeccionId] = useState(filaEnEdicion?.seccionId ?? "");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);
  const idSeccion = useId();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setSeccionHabitual(productoId, seccionId);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          if (resultado.ok) {
            if (editando) {
              router.push("/stock/seccion-habitual");
            } else {
              setProductoId("");
              setSeccionId("");
              setResetCount((n) => n + 1);
            }
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">{editando ? "Editar sección habitual" : "Fijar sección habitual"}</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto
          value={productoId}
          onChange={setProductoId}
          filtro={{ tipo: "PV", soloDisponibles: true }}
          etiquetaInicial={filaEnEdicion?.productoEtiqueta}
          limpiarSenal={resetCount}
          required
        />
      </label>

      {/* Etiqueta con htmlFor (no envolviendo): el nombre accesible del <select> queda «Sección habitual», sin el texto de sus opciones. */}
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={idSeccion}>Sección habitual</label>
        <select id={idSeccion} value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí una sección</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {mensaje && (
        <p role={ok ? "status" : "alert"} className={`text-sm ${ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensaje}
        </p>
      )}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
