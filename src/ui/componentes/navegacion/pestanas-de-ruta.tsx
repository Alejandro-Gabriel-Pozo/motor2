"use client";

import { useEffect, useRef } from "react";
import { Enlace } from "@/ui/primitivas/enlace";
import { Insignia, type TonoDeInsignia } from "@/ui/primitivas/insignia";

/**
 * Pestañas de ruta: la tira de pasos de un espacio donde cada pestaña es OTRA pantalla (una ruta), no un panel de la misma (capa `ui/componentes`: sin negocio, no importa `core/`; ver
 * test/arquitectura/ui-sin-negocio.test.ts). La usa el marco del espacio del producto.
 *
 * - Es una `<nav>` con nombre accesible (`etiqueta`, obligatoria: una página puede tener varias navegaciones) y una lista de enlaces. La pestaña `actual` lleva `aria-current="page"` y su énfasis
 *   (el trazo inferior y el texto en tinta): el énfasis NO es lo único que la marca.
 * - Una pestaña con `href: null` es un paso que el usuario no puede abrir: se dibuja como texto, SIN enlace (nunca un `<a>` sin destino, ni un enlace que lleva a «No tenés permiso»).
 * - `insignia` suma una etiqueta corta al lado del texto («Falta», «Listo»): el texto lo dice, el tono lo refuerza.
 * - En celular la tira se desplaza hacia el costado (375 px no alcanzan para cuatro pasos); cada pestaña mide 44 px de alto como mínimo. Al montarse, la tira se desplaza para dejar a la vista la pestaña actual
 *   (si no, en un paso del final quedaba fuera de pantalla y no se veía dónde se está): mueve solo la tira (`scrollLeft`), nunca la página, y sin animación. Por eso es un componente de cliente.
 *
 * - `disposicion="envuelta"`: en vez de desplazarse, las pestañas pasan a otro renglón y se leen COMPLETAS (la fila «Qué movimiento registrar», de 8 pestañas con nombres largos, que de costado quedaban cortadas).
 *   El comportamiento por defecto (`"desplazable"`) y su aspecto no cambian.
 *
 * Quién puede abrir cada pestaña lo decide quien la usa (en el servidor, con el permiso de cada pantalla): este componente solo dibuja lo que recibe. Solo tokens del sistema visual (src/app/globals.css) y sin
 * modo oscuro (DEC-04).
 */
export interface PestanaDeRuta {
  /** A dónde lleva. `null` = no se puede abrir: se muestra como texto, sin enlace. */
  href: string | null;
  texto: string;
  /** Es la pantalla en la que está el usuario. A lo sumo una. */
  actual: boolean;
  insignia?: { tono: TonoDeInsignia; texto: string };
}

export type DisposicionDePestanas = "desplazable" | "envuelta";

export interface PropsDePestanasDeRuta {
  /** El nombre de la navegación para el lector de pantalla («Pasos del producto»). */
  etiqueta: string;
  pestanas: readonly PestanaDeRuta[];
  /** Cómo se acomodan cuando no entran: se desplazan de costado (por defecto) o pasan a otro renglón, todas completas. */
  disposicion?: DisposicionDePestanas;
}

const BASE_DE_LA_PESTANA = "inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm";

function clasesDeLaPestana(p: PestanaDeRuta): string {
  if (p.href === null) return `${BASE_DE_LA_PESTANA} border-transparent text-tinta-tenue`;
  if (p.actual) return `${BASE_DE_LA_PESTANA} border-marca font-medium text-tinta`;
  return `${BASE_DE_LA_PESTANA} border-transparent text-tinta-suave hover:border-borde-control hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco`;
}

export function PestanasDeRuta({ etiqueta, pestanas, disposicion = "desplazable" }: PropsDePestanasDeRuta) {
  const tira = useRef<HTMLUListElement>(null);
  // Al montar: la pestaña actual al centro de la tira, si la tira desborda (en escritorio no hay nada que mover).
  useEffect(() => {
    const lista = tira.current;
    if (disposicion === "envuelta") return; // nada que desplazar: todas se ven
    const actual = lista?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!lista || !actual) return;
    // Posición de la pestaña dentro del contenido de la tira (la lista no es el `offsetParent` de sus enlaces: se mide con los rectángulos).
    const izquierda = actual.getBoundingClientRect().left - lista.getBoundingClientRect().left + lista.scrollLeft;
    lista.scrollLeft = izquierda - (lista.clientWidth - actual.offsetWidth) / 2;
  }, [disposicion]);
  if (etiqueta.trim() === "") throw new Error("PestanasDeRuta: la etiqueta de la navegación es obligatoria");
  if (pestanas.filter((p) => p.actual).length > 1) throw new Error("PestanasDeRuta: solo una pestaña puede ser la actual");
  return (
    <nav aria-label={etiqueta}>
      <ul ref={tira} className={`flex border-b border-borde ${disposicion === "envuelta" ? "flex-wrap" : "overflow-x-auto"}`}>
        {pestanas.map((p) => (
          <li key={p.texto} className="shrink-0">
            {p.href === null ? (
              <span aria-current={p.actual ? "page" : undefined} className={clasesDeLaPestana(p)}>
                {p.texto}
                {p.insignia && <Insignia tono={p.insignia.tono}>{p.insignia.texto}</Insignia>}
              </span>
            ) : (
              <Enlace variante="sin-estilo" href={p.href} aria-current={p.actual ? "page" : undefined} className={clasesDeLaPestana(p)}>
                {p.texto}
                {p.insignia && <Insignia tono={p.insignia.tono}>{p.insignia.texto}</Insignia>}
              </Enlace>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
