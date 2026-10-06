"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarSeccionHabitual } from "@/server/actions/stock/seccion-habitual";
import { IconoDeAccion } from "@/components/iconos";

/** Mismo patrón de confirmación inline que BotonEliminarStockMinimo (stock/minimo/boton-eliminar.tsx) — nunca window.confirm. */
export function BotonQuitarSeccionHabitual({ id, producto }: { id: string; producto: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const quitar = () => {
    startTransition(async () => {
      const r = await eliminarSeccionHabitual(id);
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmando) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-amber-700 dark:text-amber-600">¿Quitar la sección habitual de «{producto}»? Va a salir de donde haya stock.</p>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={quitar} className="text-sm text-red-600 underline">
            {pending ? "Quitando…" : "Sí, quitar"}
          </button>
          <button type="button" onClick={() => setConfirmando(false)} className="text-sm underline">
            Volver
          </button>
        </div>
        {mensaje && <p className={`text-xs ${ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{mensaje}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm underline inline-flex items-center gap-1" aria-label={`Quitar la sección habitual de ${producto}`}>
        <IconoDeAccion id="eliminar" />
        Quitar
      </button>
      {mensaje && <p className={`text-xs ${ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{mensaje}</p>}
    </div>
  );
}
