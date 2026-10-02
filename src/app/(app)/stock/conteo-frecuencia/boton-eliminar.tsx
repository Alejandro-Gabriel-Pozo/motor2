"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarFrecuenciaConteo } from "@/server/actions/stock/frecuencia-conteo";
import { IconoDeAccion } from "@/components/iconos";

/** Mismo patrón de confirmación inline que BotonEliminarStockMinimo (stock/minimo/boton-eliminar.tsx) — nunca window.confirm. */
export function BotonEliminarFrecuenciaConteo({ id, etiqueta }: { id: string; etiqueta: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const eliminar = () => {
    startTransition(async () => {
      const r = await eliminarFrecuenciaConteo(id);
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmando) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-amber-700 dark:text-amber-600">¿Eliminar la agenda de conteo de {etiqueta}? Deja de sugerirse como pendiente de contar.</p>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={eliminar} className="text-sm text-red-600 underline">
            {pending ? "Eliminando…" : "Sí, eliminar"}
          </button>
          <button type="button" onClick={() => setConfirmando(false)} className="text-sm underline">
            Volver
          </button>
        </div>
        {mensaje && <p className={`text-xs ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm underline inline-flex items-center gap-1">
        <IconoDeAccion id="eliminar" />
        Eliminar
      </button>
      {mensaje && <p className={`text-xs ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}
    </div>
  );
}
