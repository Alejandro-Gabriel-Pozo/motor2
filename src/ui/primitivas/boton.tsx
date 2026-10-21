import type { ButtonHTMLAttributes, MouseEvent } from "react";

/**
 * Botón del sistema de diseño (capa `ui/primitivas`: no conoce el negocio, no importa nada de `core/`, `server/`, `components/` ni `app/`; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - Solo tokens del sistema visual (`--color-*` de `@theme static`, src/app/globals.css) y sin modo oscuro (DEC-04): ni colores de la escala de Tailwind ni la variante de modo oscuro.
 * - Zona táctil de 44 px en celular (`min-h-11`) que baja a la compacta desde `md:` (el punto de corte del sistema): mobile first.
 * - `cargando`: la acción está en curso. NO se deshabilita de verdad (se perdería el foco del teclado, mismo criterio que `form-con-resultado.tsx`): se marca `aria-busy`,
 *   se atenúa y se ignora el clic, así un doble clic no manda dos envíos. La clave de idempotencia sigue siendo asunto del servidor.
 * - `type` es `button` por defecto: un botón dentro de un formulario no lo envía por accidente.
 * - Foco visible siempre, del color del token `foco` (el mismo contorno de 2 px que dibuja la regla global de `globals.css`: acá se repite con las MISMAS propiedades para que el
 *   botón no dependa de la capa base y, al ser una utilidad, no se suma un segundo anillo).
 */
export type VarianteDeBoton = "primario" | "acento" | "secundario" | "peligro" | "enlace" | "enlace-peligro";
export type TamanoDeBoton = "normal" | "compacto" | "chico";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-70";

const VARIANTES: Record<VarianteDeBoton, string> = {
  primario: "bg-tinta text-superficie hover:bg-tinta/85",
  acento: "bg-marca text-superficie hover:bg-marca-hover",
  secundario: "border border-borde-control bg-superficie text-tinta hover:bg-superficie-suave",
  peligro: "bg-error text-superficie hover:bg-error/90",
  enlace: "text-tinta-suave underline hover:text-tinta",
  "enlace-peligro": "text-error underline hover:decoration-2",
};

const TAMANOS: Record<TamanoDeBoton, string> = {
  normal: "min-h-11 px-4 text-sm md:min-h-9 md:px-3",
  compacto: "min-h-11 px-3 text-sm md:min-h-8",
  chico: "min-h-11 px-2 text-xs md:min-h-7",
};

export function claseDeBoton(variante: VarianteDeBoton = "primario", tamano: TamanoDeBoton = "normal"): string {
  return `${BASE} ${VARIANTES[variante]} ${TAMANOS[tamano]}`;
}

export interface PropsDeBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteDeBoton;
  tamano?: TamanoDeBoton;
  /** Hay una acción en curso: el botón avisa (`aria-busy`) e ignora los clics hasta que termine. */
  cargando?: boolean;
}

// @contrato primitiva-boton
export function Boton({ variante = "primario", tamano = "normal", cargando = false, type = "button", className, onClick, children, ...resto }: PropsDeBoton) {
  function alHacerClic(e: MouseEvent<HTMLButtonElement>) {
    if (cargando) {
      // `preventDefault` también frena el envío de un `type="submit"`.
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }
  return (
    <button {...resto} type={type} aria-busy={cargando || undefined} onClick={alHacerClic} className={`${claseDeBoton(variante, tamano)}${className ? ` ${className}` : ""}`}>
      {children}
    </button>
  );
}
