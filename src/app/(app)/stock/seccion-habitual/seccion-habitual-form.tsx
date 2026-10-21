"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setSeccionHabitual } from "@/server/actions/stock/seccion-habitual";
import { SelectorProducto } from "@/components/selector-producto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";

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

      <Selector etiqueta="Sección habitual" value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required>
        <option value="">Elegí una sección</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </Selector>

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando..." : "Guardar"}
      </Boton>
    </form>
  );
}
