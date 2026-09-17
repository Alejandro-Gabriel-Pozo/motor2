"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolverConteoPendiente, cancelarConteoFisico } from "@/server/actions/movimientos/conteo-fisico";

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
  return <p className={`text-xs ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>;
}

export function AccionesConteoPendiente({ conteoId }: { conteoId: string }) {
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
        <p className="text-xs text-amber-600">Esto va a escribir un ajuste de stock contra el saldo de HOY. ¿Confirmás?</p>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={ajustar} className="text-sm text-red-600 underline">
            {pending ? "Ajustando…" : "Sí, ajustar"}
          </button>
          <button type="button" onClick={() => setConfirmandoAjuste(false)} className="text-sm underline">
            Volver
          </button>
        </div>
        <Mensaje mensaje={mensaje} ok={ok} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={marcarResuelto} className="text-sm underline">
          Ya se cargó
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirmandoAjuste(true)} className="text-sm underline">
          Ajustar ahora
        </button>
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
        <p className="text-xs text-amber-600">Esto va a revertir el ajuste de stock que hizo este conteo. ¿Confirmás?</p>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={cancelar} className="text-sm text-red-600 underline">
            {pending ? "Cancelando…" : "Sí, cancelar"}
          </button>
          <button type="button" onClick={() => setConfirmando(false)} className="text-sm underline">
            Volver
          </button>
        </div>
        <Mensaje mensaje={mensaje} ok={ok} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm underline">
        Cancelar
      </button>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}
