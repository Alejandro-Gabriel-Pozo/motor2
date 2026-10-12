"use client";

import { useState, type ReactNode } from "react";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";

/**
 * Modal liviano y genérico — base del patrón "+ Nuevo X" inline (alta
 * rápida de Insumo/Categoría/Proveedor sin salir del form de Producto),
 * tomado de la vista de lista de ERPNext y de lo que Apps Script ya
 * resolvía bien (crearFamiliaDesdePanel/crearCategoriaDesdePanel
 * invocadas inline desde Alta/Editar Producto).
 */
export function Modal({
  triggerLabel,
  title,
  deshabilitado = false,
  children,
}: {
  triggerLabel: string;
  title: string;
  /** Deshabilita el botón que abre el modal (no cierra uno ya abierto). */
  deshabilitado?: boolean;
  children: (cerrar: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={deshabilitado}
        className="text-sm text-neutral-500 underline hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
      >
        {triggerLabel}
      </button>
      {/* Sobre el `<dialog>` nativo (ver `ui/componentes/superposiciones/dialogo.tsx`): rol de diálogo, foco atrapado y devuelto, Escape y hoja inferior en celular. */}
      <Dialogo abierto={abierto} titulo={title} onCerrar={() => setAbierto(false)}>
        {children(() => setAbierto(false))}
      </Dialogo>
    </>
  );
}
