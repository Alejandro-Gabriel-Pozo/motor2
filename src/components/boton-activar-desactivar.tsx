"use client";

import { useState } from "react";

/**
 * «Activar» / «Desactivar» de una fila de administración (roles, usuarios).
 * Activar aplica directo. Desactivar corta un acceso, así que pide confirmación
 * en la misma fila: primero «Desactivar», después «Sí, desactivar» / «Cancelar».
 * Sin diálogo del navegador (`window.confirm`): así se ve dentro de la página,
 * se puede probar con Playwright sin manejar diálogos y no lo bloquea el navegador.
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

  if (ocupado) return <span className="text-sm text-neutral-500">...</span>;

  if (!activo) {
    return (
      <button type="button" onClick={onCambiar} className="text-sm underline">
        Activar
      </button>
    );
  }

  if (!confirmando) {
    return (
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm underline">
        Desactivar
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm text-red-600">{aviso}</span>
      <button
        type="button"
        onClick={() => {
          setConfirmando(false);
          onCambiar();
        }}
        className="text-sm font-medium text-red-600 underline"
      >
        Sí, desactivar
      </button>
      <button type="button" onClick={() => setConfirmando(false)} className="text-sm underline">
        Cancelar
      </button>
    </span>
  );
}
