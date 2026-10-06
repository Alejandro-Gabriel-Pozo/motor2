"use client";

import { useLinkStatus } from "next/link";

/**
 * Indicador de navegación en curso (pendiente #44): va DENTRO de un `<Link>` y se ve mientras la ruta de destino carga (solo cuando la navegación no es
 * instantánea: destino dinámico sin prefetch). Es un `<span>` de tamaño fijo siempre presente, cuya opacidad cambia por CSS (`.indicador-enlace` en
 * globals.css), así no mueve la maquetación. Es `aria-hidden` y SIN role: Next ya anuncia el cambio de ruta a lectores de pantalla (app-router-announcer) y
 * un `role="status"` global chocaría con los `getByRole("status")` de los formularios.
 */
export function IndicadorDeEnlace() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className="indicador-enlace" data-pendiente={pending ? "true" : "false"} />;
}
