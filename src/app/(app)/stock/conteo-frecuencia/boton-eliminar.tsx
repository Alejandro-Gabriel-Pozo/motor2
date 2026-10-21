"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarFrecuenciaConteo } from "@/server/actions/stock/frecuencia-conteo";
import { IconoDeAccion } from "@/components/iconos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

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
        <p className="text-xs text-aviso-tinta">¿Eliminar la agenda de conteo de {etiqueta}? Deja de sugerirse como pendiente de contar.</p>
        <div className="flex gap-2">
          <Boton variante="enlace-peligro" tamano="en-fila" disabled={pending} onClick={eliminar}>
            {pending ? "Eliminando…" : "Sí, eliminar"}
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
      <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmando(true)}>
        <IconoDeAccion id="eliminar" />
        Eliminar
      </Boton>
      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}
    </div>
  );
}
