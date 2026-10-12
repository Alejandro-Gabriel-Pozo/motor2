"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Diálogo del sistema de diseño (capa `ui/componentes`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts). Un único componente con dos comportamientos:
 * hoja inferior en celular y diálogo centrado desde `sm:` (mobile first, sin duplicar componentes).
 *
 * Está hecho sobre el `<dialog>` NATIVO con `showModal()`, que ya resuelve lo que el `Modal` anterior no hacía:
 *  - rol de diálogo modal y nombre accesible (`aria-labelledby` al título);
 *  - el resto de la página queda inerte (el foco no llega a nada de atrás; con Tab puede salir a la barra del navegador, como en cualquier diálogo nativo) y, al cerrar,
 *    el foco vuelve al control que lo abrió;
 *  - Escape cierra (evento `close` → `onCerrar`);
 *  - clic en el fondo cierra.
 * Los hijos se montan solo mientras está abierto: al cerrar se pierde su estado (mismo comportamiento que el `Modal` de antes).
 *
 * El padre manda `abierto` y `onCerrar`; el diálogo nunca se cierra solo sin avisarle, así que su estado y el del DOM no se separan.
 */
export function Dialogo({ abierto, titulo, onCerrar, children }: { abierto: boolean; titulo: string; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      onClick={(e) => {
        // El relleno del diálogo es 0 y el contenido va en un <div> interno: un clic cuyo destino es el <dialog> mismo es un clic en el fondo.
        if (e.target === e.currentTarget) onCerrar();
      }}
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-0 text-neutral-900 shadow-lg backdrop:bg-black/40 sm:my-auto sm:max-w-sm sm:rounded-lg dark:bg-neutral-900 dark:text-neutral-100"
    >
      {abierto ? (
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id={idTitulo} className="font-medium">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 sm:min-h-8 sm:min-w-8 dark:text-neutral-400 dark:hover:text-neutral-100 dark:focus-visible:outline-neutral-100"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
