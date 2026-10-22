import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Enlace del sistema de diseño: `next/link` con el aspecto de los tokens (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - `variante`: `texto` (por defecto: el enlace de un párrafo o de una celda, subrayado, de la tinta suave y de la tinta al pasar el mouse, con el foco del sistema) o `sin-estilo` (no agrega
 *   ninguna clase: la tarjeta, la fila o el ítem del menú que es un enlace y se viste con su propio `className`; el foco de teclado lo dibuja la regla global de `globals.css`). Un enlace dentro
 *   de un texto no lleva piso de 44 px (WCAG 2.5.8: los enlaces en línea están exceptuados); el que es una tarjeta o un ítem lo pone en su `className`.
 * - Todo lo demás es de `next/link` (`href`, `prefetch`, `replace`, `scroll`, `ref`…).
 * - NO decide permisos: es un `Link` a secas. Un enlace a OTRA pantalla que el rol del usuario puede no ver sigue yendo por `EnlaceInterno`; `test/arquitectura/enlaces-con-permiso.test.ts`
 *   mira `<Link>` y `<Enlace>` por igual, así que usar esta primitiva no es una manera de saltearse esa guarda.
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04).
 */
export type VarianteDeEnlace = "texto" | "sin-estilo";

export type PropsDeEnlace = ComponentProps<typeof Link> & { variante?: VarianteDeEnlace };

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco";

const VARIANTES: Record<VarianteDeEnlace, string> = {
  texto: `text-tinta-suave underline hover:text-tinta ${FOCO}`,
  "sin-estilo": "",
};

// @contrato primitiva-enlace
export function Enlace({ variante = "texto", className, ...resto }: PropsDeEnlace) {
  const clases = [VARIANTES[variante], className].filter(Boolean).join(" ");
  // `sin-estilo` sin `className` no deja un `class=""` vacío en el HTML.
  return <Link {...resto} className={clases || undefined} />;
}
