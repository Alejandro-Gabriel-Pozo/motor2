"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * «Activar» / «Desactivar» de una fila de administración (roles, usuarios).
 * Activar aplica directo. Desactivar corta un acceso, así que pide confirmación
 * en la misma fila: primero «Desactivar», después «Sí, desactivar» / «Cancelar».
 * Sin diálogo del navegador (`window.confirm`): así se ve dentro de la página,
 * se puede probar con Playwright sin manejar diálogos y no lo bloquea el navegador.
 *
 * Teclado y lector de pantalla: al abrir la confirmación el foco va a «Cancelar»
 * (lo seguro por defecto en una acción destructiva), el aviso se anuncia
 * (`role="alert"`) y ambos botones lo leen como descripción (el foco cae en «Cancelar»,
 * y algunos lectores no anuncian una alerta que aparece ya con texto), Escape cancela
 * y al cancelar el foco vuelve a «Desactivar».
 */
export function BotonActivarDesactivar({
  activo,
  ocupado,
  aviso,
  onCambiar,
}: {
  activo: boolean;
  /** Hay una llamada al servidor en curso para esta fila. */
  ocupado: boolean;
  /** Qué implica desactivar; se muestra junto a la confirmación. */
  aviso: string;
  onCambiar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [activoPrevio, setActivoPrevio] = useState(activo);
  const idAviso = useId();
  const botonDesactivar = useRef<HTMLButtonElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  const volverAlBoton = useRef(false);

  // Si el estado de la fila cambia desde afuera (otra pestaña, otro usuario), la confirmación
  // abierta ya no aplica: sin esto reaparecería sola cuando la fila vuelva a estar activa.
  if (activo !== activoPrevio) {
    setActivoPrevio(activo);
    setConfirmando(false);
  }

  const mostrarConfirmacion = activo && confirmando;

  useEffect(() => {
    if (mostrarConfirmacion) {
      botonCancelar.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonDesactivar.current?.focus();
    }
  }, [mostrarConfirmacion]);

  function cancelar() {
    volverAlBoton.current = true;
    setConfirmando(false);
  }

  if (ocupado) return <span className="text-sm text-neutral-500">...</span>;

  if (!activo) {
    return (
      <button type="button" onClick={onCambiar} className="text-sm underline">
        Activar
      </button>
    );
  }

  if (!mostrarConfirmacion) {
    return (
      <button ref={botonDesactivar} type="button" onClick={() => setConfirmando(true)} className="text-sm underline">
        Desactivar
      </button>
    );
  }

  return (
    <span
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") cancelar();
      }}
    >
      <span id={idAviso} role="alert" className="text-sm text-red-600">
        {aviso}
      </span>
      <button
        type="button"
        aria-describedby={idAviso}
        onClick={() => {
          setConfirmando(false);
          onCambiar();
        }}
        className="text-sm font-medium text-red-600 underline"
      >
        Sí, desactivar
      </button>
      <button ref={botonCancelar} type="button" aria-describedby={idAviso} onClick={cancelar} className="text-sm underline">
        Cancelar
      </button>
    </span>
  );
}
