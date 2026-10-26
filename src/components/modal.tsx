"use client";

import { useState, type ReactNode } from "react";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Boton } from "@/ui/primitivas/boton";

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
      <Boton variante="enlace" tamano="en-fila" onClick={() => setAbierto(true)} disabled={deshabilitado}>
        {triggerLabel}
      </Boton>
      {/* Sobre el `<dialog>` nativo (ver `ui/componentes/superposiciones/dialogo.tsx`): rol de diálogo, foco atrapado y devuelto, Escape y hoja inferior en celular. */}
      <Dialogo abierto={abierto} titulo={title} onCerrar={() => setAbierto(false)}>
        {children(() => setAbierto(false))}
      </Dialogo>
    </>
  );
}
