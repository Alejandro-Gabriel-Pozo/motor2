"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { useAvisar } from "./aviso-mesa";

/**
 * Molde de cada acción de la pantalla de la mesa (el mismo de `NuevaMesa`): corre la Server Action en una transición; si sale bien,
 * publica el mensaje en el aviso de la pantalla (`role="status"`), refresca la vista (`router.refresh()`: las acciones no refrescan
 * solas) y avisa a quien llamó con el resultado (para cerrar un diálogo, limpiar un campo o pedir una impresión con lo que devolvió
 * la acción); si no, deja el mensaje en `error` para mostrarlo junto al control (`role="alert"`).
 */
export function useAccionMesa() {
  const router = useRouter();
  const avisar = useAvisar();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ejecutar = <R extends ResultadoAccion>(accion: () => Promise<R>, alSalirBien?: (resultado: Extract<R, { ok: true }>) => void) => {
    setError(null);
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      avisar(r.mensaje);
      alSalirBien?.(r as Extract<R, { ok: true }>);
      router.refresh();
    });
  };

  return { ejecutar, pending, error, setError };
}
