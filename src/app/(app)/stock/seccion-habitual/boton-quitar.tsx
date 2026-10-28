"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarSeccionHabitual } from "@/server/actions/stock/seccion-habitual";
import { IconoDeAccion } from "@/components/iconos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

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
        <p className="text-xs text-aviso-tinta">¿Quitar el depósito habitual de «{producto}»? Va a salir de donde haya stock.</p>
        <div className="flex gap-2">
          <Boton variante="enlace-peligro" tamano="en-fila" disabled={pending} onClick={quitar}>
            {pending ? "Quitando…" : "Sí, quitar"}
          </Boton>
          <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmando(false)}>
            Volver
          </Boton>
        </div>
        {mensaje && (
          <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
            {mensaje}
          </Aviso>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmando(true)} aria-label={`Quitar el depósito habitual de ${producto}`}>
        <IconoDeAccion id="eliminar" />
        Quitar
      </Boton>
      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}
    </div>
  );
}
