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
 *
 * Dos opciones para un diálogo que CONFIRMA algo (cerrar una cuenta, anular, crear una mesa):
 *  - `cerrable={false}` (por defecto es `true`) mientras la acción está en curso: Escape, el clic en el fondo y la ✕ no lo cierran (así no se pierde de vista un envío que ya salió ni se deja
 *    el estado a medias). Si el navegador lo cierra igual (Chrome deja cerrar con un segundo Escape seguido), se vuelve a abrir en el acto: el estado del padre sigue siendo «abierto».
 *  - `data-foco-inicial` en un control (o en un contenedor que lo tenga adentro): al abrirse, el foco va ahí. Sin eso el navegador enfoca el primer control del diálogo, la ✕ de cerrar: es lo
 *    seguro para una confirmación de dinero (no cae sobre «Confirmar»). Un `autoFocus` de React NO sirve acá: corre al montar los hijos, con el diálogo todavía cerrado, y no enfoca nada.
 *
 * Forma y ancho (props opcionales; sin ellas, el diálogo es el de siempre):
 *  - `forma="centrado"` (por defecto): hoja inferior en celular y diálogo centrado desde `sm:`. `ancho` elige cuánto mide ahí: `angosto` (por defecto, `sm:max-w-sm`) o `ancho` (`md:max-w-2xl`, para
 *    un formulario o una tabla adentro).
 *  - `forma="lateral"`: un panel pegado a la derecha, de alto completo, que en celular ocupa todo el ancho y desde `md:` mide `max-w-md`. Su ancho es fijo: con `forma="lateral"` el tipo no deja pasar `ancho`.
 *
 * Solo tokens del sistema visual (src/app/globals.css: `bg-superficie`, `text-tinta`, `backdrop:bg-velo`…) y sin modo oscuro (DEC-04): no hay variantes `dark:` ni un atributo para apagarlas.
 */
type AnchoDeDialogo = "angosto" | "ancho";
type FormaDeDialogo = "centrado" | "lateral";

interface PropsBasicasDeDialogo {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  /** `false` mientras una acción está en curso: no se cierra con Escape, con el fondo ni con la ✕. Por defecto `true`. */
  cerrable?: boolean;
}

type PropsDeDialogo = PropsBasicasDeDialogo & ({ forma?: "centrado"; ancho?: AnchoDeDialogo } | { forma: "lateral"; ancho?: never });

const BASE = "w-full overflow-y-auto bg-superficie p-0 text-tinta shadow-lg backdrop:bg-velo";

const POR_FORMA: Record<FormaDeDialogo, string> = {
  centrado: "mx-auto mt-auto mb-0 max-h-[90dvh] max-w-md rounded-t-lg sm:my-auto sm:rounded-lg",
  lateral: "ml-auto mr-0 h-dvh max-h-dvh max-w-full rounded-none md:max-w-md",
};

/** Solo de la forma centrada: el ancho que tiene desde `sm:` (angosto) o desde `md:` (ancho; entre `sm:` y `md:` sigue en `max-w-md`). */
const POR_ANCHO: Record<AnchoDeDialogo, string> = {
  angosto: "sm:max-w-sm",
  ancho: "md:max-w-2xl",
};

const ENFOCABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function Dialogo({ abierto, titulo, onCerrar, children, forma = "centrado", ancho = "angosto", cerrable = true }: PropsDeDialogo) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      d.showModal();
      const destino = d.querySelector<HTMLElement>("[data-foco-inicial]");
      if (destino) (destino.matches(ENFOCABLE) ? destino : destino.querySelector<HTMLElement>(ENFOCABLE))?.focus();
    }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        if (!cerrable) e.preventDefault();
      }}
      onClose={() => {
        // Cerrado por el navegador pese a `cerrable={false}` (un segundo Escape seguido) mientras el padre sigue «abierto»: se vuelve a mostrar. Si el padre ya lo cerró (`abierto` es falso), es el
        // cierre que él mismo pidió y se le avisa como siempre.
        if (!cerrable && abierto) ref.current?.showModal();
        else onCerrar();
      }}
      onClick={(e) => {
        // El relleno del diálogo es 0 y el contenido va en un <div> interno: un clic cuyo destino es el <dialog> mismo es un clic en el fondo.
        if (e.target === e.currentTarget && cerrable) onCerrar();
      }}
      className={`${BASE} ${POR_FORMA[forma]}${forma === "centrado" ? ` ${POR_ANCHO[ancho]}` : ""}`}
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
              disabled={!cerrable}
              aria-label="Cerrar"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-tinta-suave hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco disabled:opacity-50 sm:min-h-8 sm:min-w-8"
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
