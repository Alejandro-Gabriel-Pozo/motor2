"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconoDeAccion } from "@/components/iconos";
import { anularVenta } from "@/server/actions/movimientos/venta";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

/**
 * Antes era un `<form action={...}>` crudo que descartaba el resultado
 * (ni éxito ni error llegaban a la pantalla) y actuaba al instante, sin
 * confirmación — pese a revertir stock real (docs/comparativa-ux-
 * erpnext-dolibarr.md §8.2). Mismo patrón de confirmación inline que
 * `BotonEliminarStockMinimo` (nunca `window.confirm`).
 *
 * E0 de la corrección por ajuste (2026-11-06): pide el MOTIVO (obligatorio, hasta 200 caracteres; el servidor lo vuelve a validar). Un segundo
 * clic mientras corre la anulación no hace nada (`pending`), y un reenvío tardío responde «ya está anulada» sin escribir otro contra-asiento.
 */
export function BotonAnularVenta({ idOperacion }: { idOperacion: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const anular = () => {
    startTransition(async () => {
      const r = await anularVenta(idOperacion, motivo);
      setMensaje(r.mensaje);
      setOk(r.ok);
      // Con error (p. ej. motivo vacío o posterior) se queda el formulario abierto para corregirlo; con éxito se cierra.
      if (r.ok) {
        setConfirmando(false);
        setMotivo("");
        router.refresh();
      }
    });
  };

  if (confirmando) {
    return (
      <div className="mb-2 flex flex-col gap-1">
        <p className="text-xs text-aviso-tinta">¿Anular esta venta? Revierte el stock consumido — no se puede deshacer.</p>
        <Campo etiqueta="Motivo de la anulación" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        <div className="flex gap-2">
          <Boton variante="enlace-peligro" tamano="en-fila" disabled={pending || !motivo.trim()} onClick={anular}>
            {pending ? "Anulando…" : "Sí, anular"}
          </Boton>
          <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={() => setConfirmando(false)}>
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
    <div className="mb-2 flex flex-col gap-1">
      <Boton variante="enlace-peligro" tamano="en-fila" onClick={() => setConfirmando(true)}>
        <IconoDeAccion id="anular" />
        Anular venta
      </Boton>
      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}
    </div>
  );
}
