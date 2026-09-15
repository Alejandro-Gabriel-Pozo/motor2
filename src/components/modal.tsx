"use client";

import { useState, type ReactNode } from "react";

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
  children,
}: {
  triggerLabel: string;
  title: string;
  children: (cerrar: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        {triggerLabel}
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium">{title}</h3>
              <button type="button" onClick={() => setAbierto(false)} className="text-neutral-500">
                ✕
              </button>
            </div>
            {children(() => setAbierto(false))}
          </div>
        </div>
      )}
    </>
  );
}
