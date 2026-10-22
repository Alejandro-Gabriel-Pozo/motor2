"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolverConteoPendiente, cancelarConteoFisico } from "@/server/actions/movimientos/conteo-fisico";
import { Boton } from "@/ui/primitivas/boton";

/**
 * "Ajustar ahora" y "Cancelar" son las dos acciones del módulo con más
 * potencial de tocar stock por error de un clic (escriben un movimiento
 * de ajuste real) — antes eran <form action={...}> conectados directo al
 * server action, sin ningún paso intermedio. Mismo patrón de confirmación
 * inline ya usado en catalogo (FormRenombrarInsumo) en vez de
 * window.confirm, que no existe en ningún otro lugar del proyecto.
 */
function Mensaje({ mensaje, ok }: { mensaje: string | null; ok: boolean }) {
  if (!mensaje) return null;
  return <p className={`text-xs ${ok ? "text-ok-tinta" : "text-error"}`}>{mensaje}</p>;
}

/** `puedeAjustar`: cortesía, no barrera (S-09, D3): «Ajustar ahora» mueve el stock y la acción exige `proceso_ajuste`; sin él solo se ofrece «Ya se cargó». */
export function AccionesConteoPendiente({ conteoId, puedeAjustar }: { conteoId: string; puedeAjustar: boolean }) {
  const router = useRouter();
  const [confirmandoAjuste, setConfirmandoAjuste] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const marcarResuelto = () => {
    startTransition(async () => {
      const r = await resolverConteoPendiente(conteoId, "resuelto");
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  const ajustar = () => {
    startTransition(async () => {
      const r = await resolverConteoPendiente(conteoId, "ajustar");
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmandoAjuste(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmandoAjuste) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-aviso-tinta">Esto va a escribir un ajuste de stock contra el saldo de HOY. ¿Confirmás?</p>
        <div className="flex gap-2">
          <Boton variante="enlace-peligro" tamano="en-fila" disabled={pending} onClick={ajustar}>
            {pending ? "Ajustando…" : "Sí, ajustar"}
          </Boton>
          <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmandoAjuste(false)}>
            Volver
          </Boton>
        </div>
        <Mensaje mensaje={mensaje} ok={ok} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={marcarResuelto}>
          Ya se cargó
        </Boton>
        {puedeAjustar && (
          <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={() => setConfirmandoAjuste(true)}>
            Ajustar ahora
          </Boton>
        )}
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

export function BotonCancelarConteo({ conteoId }: { conteoId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const cancelar = () => {
    startTransition(async () => {
      const r = await cancelarConteoFisico(conteoId);
      setMensaje(r.mensaje);
      setOk(r.ok);
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  };

  if (confirmando) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-aviso-tinta">Esto va a revertir el ajuste de stock que hizo este conteo. ¿Confirmás?</p>
        <div className="flex gap-2">
          <Boton variante="enlace-peligro" tamano="en-fila" disabled={pending} onClick={cancelar}>
            {pending ? "Cancelando…" : "Sí, cancelar"}
          </Boton>
          <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmando(false)}>
            Volver
          </Boton>
        </div>
        <Mensaje mensaje={mensaje} ok={ok} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Boton variante="enlace" tamano="en-fila" onClick={() => setConfirmando(true)} className="self-start">
        Cancelar
      </Boton>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}
