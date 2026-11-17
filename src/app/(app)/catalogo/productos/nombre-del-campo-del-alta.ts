/**
 * Cómo se nombra un campo del formulario de producto (dirección del dueño, 2026-11-17: «estéticamente Pedernal es superior… en Pedernal algo limpio, en Motor 2 algo apretado»): en el ALTA «como Pedernal» el
 * rótulo se VE siempre arriba del campo (como en la maqueta de Pedernal) y el control no repite su nombre adentro; en la edición y con el interruptor apagado queda como antes (el nombre dentro del campo, como
 * `aria-label` y `placeholder`). El texto es el mismo en los dos casos: acá no se inventa ninguno. Vive aparte para que `producto-form.tsx` (sobre el tope de líneas) no crezca.
 */
export function nombreDelCampo(rotuloVisible: boolean, texto: string): { etiqueta: string; "aria-label"?: never; placeholder?: never } | { "aria-label": string; placeholder: string; etiqueta?: never } {
  return rotuloVisible ? { etiqueta: texto } : { "aria-label": texto, placeholder: texto };
}
