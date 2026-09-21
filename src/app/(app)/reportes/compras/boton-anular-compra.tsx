"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { anularCompra } from "@/server/actions/movimientos/compras";

/**
 * «Anular compra» del detalle de una compra registrada (K1c). Anular revierte el stock y saca la compra del gasto, así que pide confirmación en el
 * mismo lugar («Anular compra» → «Sí, anular» / «Cancelar»), sin diálogo del navegador (`window.confirm`): se ve dentro de la página y se puede probar
 * con Playwright. Mismas reglas de teclado y lector de pantalla que `BotonActivarDesactivar`: al abrir la confirmación el foco va a «Cancelar» (lo seguro
 * en una acción que no se deshace), el aviso se anuncia (`role="alert"`) y ambos botones lo leen como descripción, Escape cancela y al cancelar el foco
 * vuelve a «Anular compra».
 *
 * La clave de idempotencia (un UUID) se genera al abrir la confirmación y se reenvía tal cual si se reintenta desde esa misma confirmación: si la respuesta
 * se perdió, un reenvío devuelve el mensaje original en vez de «ya está anulada».
 *
 * Si el servidor la rechaza (típicamente porque lo comprado ya se consumió), el mensaje queda a la vista con `role="alert"` y el botón vuelve a estar
 * disponible. Si se anula, la página se refresca (`router.refresh()`, lo pide quien tiene el router) y la fila pasa a mostrarse marcada como anulada; este
 * componente sigue montado (recibe `anulada`) para dejar el aviso de éxito en pantalla, con el foco puesto en él.
 */
/** `resumen` completa la frase «la compra …» (ej. «del 2026-09-21 a Molino SA, factura A-1»): identifica de cuál se trata cuando hay muchos botones iguales en la página. */
export function BotonAnularCompra({ idOperacion, resumen, anulada }: { idOperacion: string; resumen: string; anulada: boolean }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [claveIdempotencia, setClaveIdempotencia] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const idAviso = useId();
  const botonAnular = useRef<HTMLButtonElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  const avisoDeExito = useRef<HTMLParagraphElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (confirmando) {
      botonCancelar.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonAnular.current?.focus();
    }
  }, [confirmando]);

  // Al anularse, el botón desaparece: el foco se lleva al aviso de éxito para que no caiga al <body>.
  useEffect(() => {
    if (anulada && resultado?.ok) avisoDeExito.current?.focus();
  }, [anulada, resultado]);

  function abrirConfirmacion() {
    setResultado(null);
    setClaveIdempotencia(crypto.randomUUID());
    setConfirmando(true);
  }

  function cancelar() {
    volverAlBoton.current = true;
    setConfirmando(false);
  }

  function confirmar() {
    startTransition(async () => {
      const r = await anularCompra(idOperacion, claveIdempotencia);
      setResultado({ ok: r.ok, mensaje: r.mensaje });
      volverAlBoton.current = !r.ok;
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  }

  const aviso = resultado && (
    <p
      ref={resultado.ok ? avisoDeExito : undefined}
      tabIndex={resultado.ok ? -1 : undefined}
      role={resultado.ok ? "status" : "alert"}
      className={`text-sm ${resultado.ok ? "text-green-700" : "text-red-600"}`}
    >
      {resultado.mensaje}
    </p>
  );

  // Ya anulada: no hay nada que hacer, salvo dejar visible el aviso de éxito de esta sesión.
  if (anulada) return aviso || null;

  if (confirmando) {
    return (
      <div
        className="flex flex-col gap-1"
        onKeyDown={(evento) => {
          if (evento.key === "Escape") cancelar();
        }}
      >
        <p id={idAviso} role="alert" className="text-sm text-red-600">
          ¿Anular la compra {resumen}? Revierte el stock de lo que se compró y la saca del gasto. No se puede deshacer.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button type="button" aria-describedby={idAviso} disabled={pending} onClick={confirmar} className="text-sm font-medium text-red-600 underline disabled:opacity-50">
            {pending ? "Anulando…" : "Sí, anular"}
          </button>
          <button ref={botonCancelar} type="button" aria-describedby={idAviso} disabled={pending} onClick={cancelar} className="text-sm underline">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button ref={botonAnular} type="button" aria-label={`Anular compra ${resumen}`} onClick={abrirConfirmacion} className="self-start text-sm text-red-600 underline">
        Anular compra
      </button>
      {aviso}
    </div>
  );
}
