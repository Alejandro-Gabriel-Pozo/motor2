"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { anularVenta } from "@/server/actions/movimientos/venta";

/**
 * Antes era un `<form action={...}>` crudo que descartaba el resultado
 * (ni éxito ni error llegaban a la pantalla) y actuaba al instante, sin
 * confirmación — pese a revertir stock real (docs/comparativa-ux-
 * erpnext-dolibarr.md §8.2). Mismo patrón de confirmación inline que
 * `BotonEliminarStockMinimo` (nunca `window.confirm`).
 */
export function BotonAnularVenta({ idOperacion }: { idOperacion: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const anular = () => {
    startTransition(async () => {
      const r = await anularVenta(idOperacion);
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmando) {
    return (
      <div className="mb-2 flex flex-col gap-1">
        <p className="text-xs text-amber-700 dark:text-amber-600">¿Anular esta venta? Revierte el stock consumido — no se puede deshacer.</p>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={anular} className="text-sm text-red-600 underline">
            {pending ? "Anulando…" : "Sí, anular"}
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
    <div className="mb-2 flex flex-col gap-1">
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm text-red-600 underline">
        Anular venta
      </button>
      {mensaje && <p className={`text-xs ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}
    </div>
  );
}
