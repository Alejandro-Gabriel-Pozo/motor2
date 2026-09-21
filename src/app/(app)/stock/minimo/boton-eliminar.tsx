"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarStockMinimo } from "@/server/actions/stock/stock-minimo";

/**
 * "Eliminar" acá es la única acción de borrado duro de toda la app (no es
 * un movimiento de Kardex reversible — borra la fila) y antes actuaba al
 * instante, sin ningún paso intermedio. Mismo patrón de confirmación
 * inline ya usado en catalogo/movimientos (nunca window.confirm).
 */
export function BotonEliminarStockMinimo({ id, etiqueta }: { id: string; etiqueta: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const eliminar = () => {
    startTransition(async () => {
      const r = await eliminarStockMinimo(id);
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmando) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-amber-700 dark:text-amber-600">¿Eliminar el mínimo de {etiqueta}? Deja de alertar sobre este producto/sección.</p>
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
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm underline">
        Eliminar
      </button>
      {mensaje && <p className={`text-xs ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}
    </div>
  );
}
