"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { habilitarMostrador } from "@/server/actions/pos/mesas";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

/**
 * «Habilitar el mostrador» (ADR-039): crea una vez el puesto de venta «Mostrador» de la sucursal. Sin permiso de Editar en `pos_alta_mesa` el botón queda deshabilitado (igual la acción
 * lo rechaza en el servidor). Mientras corre no se vuelve a pulsar (el doble clic no manda dos pedidos) y, si de todos modos hubiera dos, la acción es idempotente por estado: la segunda responde
 * «ya estaba habilitado». Al salir bien refresca la vista (la acción no refresca sola).
 */
export function HabilitarMostrador({ puede }: { puede: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const habilitar = () => {
    setError(null);
    startTransition(async () => {
      const r = await habilitarMostrador();
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Boton variante="acento" disabled={!puede || pending} title={puede ? undefined : "Tu rol puede ver el mostrador pero no habilitarlo."} onClick={habilitar}>
        {pending ? "Habilitando…" : "Habilitar el mostrador"}
      </Boton>
      {error && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </div>
  );
}
