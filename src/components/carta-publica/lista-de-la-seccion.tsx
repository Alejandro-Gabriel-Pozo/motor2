"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

/**
 * Carta «B», E2 (invitación «5+2», decisión del dueño, 2026-11-04): la lista de platos de UNA sección, con la única interacción de la carta nueva. Las palabras «guarnición» y «salsa» de la línea «Incluye …»
 * de cada plato son botones reales (`data-ir-al-bloque`, los dibuja `seccion.tsx` en el servidor): al tocar uno, la lista baja al bloque de ese grupo (scroll suave; sin animación con «movimiento reducido»), lo
 * ilumina (`data-iluminado`: el bloque muestra «Va con: …» y un borde) y marca con una barra lateral (`data-marcado`) a los platos que lo incluyen (`data-plato`, los de `data-platos` del bloque). A los pocos
 * segundos todo vuelve a su lugar. El bloque recibe el foco (sin saltar) para que un lector de pantalla lo lea. En la carta impresa no hay interacción (lo decide el CSS de impresión).
 *
 * Mínimo a propósito: ni estado de React ni datos propios. La lista y sus filas se arman en el servidor y llegan como `children` (no entran al paquete del cliente); acá solo se escucha el toque y se cambian
 * atributos del DOM que ya está. Tocar dos veces (o tocar otra palabra) apaga lo anterior y vuelve a empezar: nunca queda nada a medias ni se duplican las marcas.
 */

/** Cuánto dura iluminado el bloque (ms). */
const DURACION_DEL_RESALTADO_MS = 6000;

export function ListaDeLaSeccion({ children, nombre, className }: { children: ReactNode; nombre: string; className: string }) {
  const lista = useRef<HTMLUListElement>(null);
  const temporizador = useRef<number | undefined>(undefined);

  /** Saca todas las marcas de la lista. */
  const apagar = () => {
    window.clearTimeout(temporizador.current);
    lista.current?.querySelectorAll("[data-iluminado]").forEach((el) => el.removeAttribute("data-iluminado"));
    lista.current?.querySelectorAll("[data-marcado]").forEach((el) => el.removeAttribute("data-marcado"));
  };

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const alTocar = (e: MouseEvent<HTMLUListElement>) => {
    const raiz = lista.current;
    const boton = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-ir-al-bloque]") : null;
    if (!raiz || !boton || !raiz.contains(boton)) return;
    const bloque = [...raiz.querySelectorAll<HTMLElement>("[data-bloque-de-opciones]")].find((b) => b.dataset.bloqueDeOpciones === boton.dataset.irAlBloque);
    if (!bloque) return;
    apagar();
    bloque.setAttribute("data-iluminado", "");
    for (const posicion of (bloque.dataset.platos ?? "").split(",")) {
      if (posicion !== "") raiz.querySelector(`[data-plato="${posicion}"]`)?.setAttribute("data-marcado", "");
    }
    const sinAnimacion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bloque.scrollIntoView({ behavior: sinAnimacion ? "auto" : "smooth", block: "start" });
    bloque.focus({ preventScroll: true });
    temporizador.current = window.setTimeout(apagar, DURACION_DEL_RESALTADO_MS);
  };

  return (
    // La lista tiene scroll propio y casi siempre desborda (platos + bloques): `tabIndex={0}` la hace alcanzable con teclado (axe: scrollable-region-focusable). El `onClick` solo escucha el toque de los botones de adentro.
    <ul ref={lista} data-carta-scroll tabIndex={0} aria-label={nombre} className={className} onClick={alTocar}>
      {children}
    </ul>
  );
}
