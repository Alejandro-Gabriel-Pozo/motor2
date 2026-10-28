"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarStockMinimo } from "@/server/actions/stock/stock-minimo";
import { IconoDeAccion } from "@/components/iconos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

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
        <p className="text-xs text-aviso-tinta">¿Eliminar el mínimo de {etiqueta}? Deja de alertar sobre este insumo en ese depósito.</p>
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
