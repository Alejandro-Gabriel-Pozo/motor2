import type { ButtonHTMLAttributes, MouseEvent } from "react";

/**
 * Botón del sistema de diseño (capa `ui/primitivas`: no conoce el negocio, no importa nada de `core/`, `server/`, `components/` ni `app/`; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - Zona táctil de 44 px en celular (`min-h-11`) que baja a la compacta en pantallas anchas (`sm:`): mobile first.
 * - `cargando`: la acción está en curso. NO se deshabilita de verdad (se perdería el foco del teclado, mismo criterio que `form-con-resultado.tsx`): se marca `aria-busy`,
 *   se atenúa y se ignora el clic, así un doble clic no manda dos envíos. La clave de idempotencia sigue siendo asunto del servidor.
 * - `type` es `button` por defecto: un botón dentro de un formulario no lo envía por accidente.
 * - Foco visible siempre.
 */
export type VarianteDeBoton = "primario" | "secundario" | "peligro" | "enlace";
export type TamanoDeBoton = "normal" | "chico";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:focus-visible:outline-neutral-100 disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-70";

const VARIANTES: Record<VarianteDeBoton, string> = {
  primario: "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200",
  secundario: "border border-neutral-400 bg-transparent hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800",
  peligro: "bg-red-700 text-white hover:bg-red-800",
  enlace: "text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100",
};

const TAMANOS: Record<TamanoDeBoton, string> = {
  normal: "min-h-11 px-4 text-sm sm:min-h-9 sm:px-3",
  chico: "min-h-11 px-3 text-sm sm:min-h-7 sm:px-2 sm:text-xs",
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
