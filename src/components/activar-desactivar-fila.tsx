"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonActivarDesactivar } from "@/components/boton-activar-desactivar";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * «Activar» / «Desactivar» para una fila de una página de servidor (sucursales): junta
 * `BotonActivarDesactivar` (que pide confirmación al desactivar) con el llamado a la
 * server action, el mensaje del resultado y el refresco de la fila. Las tablas de
 * cliente (roles, usuarios) usan `BotonActivarDesactivar` directo, con su propio estado.
 *
 * `accion` es una server action inline de la página, ya con el id y el estado nuevo
 * cerrados: `async () => { "use server"; return actualizarActivoX(id, !activo); }`.
 */
export function ActivarDesactivarFila({
  activo,
  aviso,
  accion,
}: {
  activo: boolean;
  /** Qué implica desactivar; se muestra junto a la confirmación. */
  aviso: string;
  accion: () => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pending, startTransition] = useTransition();

  function cambiar() {
    setResultado(null);
    startTransition(async () => {
      const r = await accion();
      setResultado(r);
      // Una server action que no revalida no vuelve a renderizar la página: sin esto la columna «Activo» seguiría igual.
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <BotonActivarDesactivar activo={activo} ocupado={pending} aviso={aviso} onCambiar={cambiar} />
      {resultado && (
        <p role={resultado.ok ? "status" : "alert"} className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}>
          {resultado.mensaje}
        </p>
      )}
    </div>
  );
}
