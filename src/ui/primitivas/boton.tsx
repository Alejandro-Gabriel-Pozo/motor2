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
 *   botón no dependa de la capa base y, al ser una utilidad, no se suma un segundo anillo). La variante `sobre-tinta` (para fondos oscuros) usa `foco-sobre-tinta`.
 * - `tamano="tactil"`: 44 px de alto en cualquier ancho (los demás bajan a la compacta desde `md:`).
 * - `variante="interruptor"`: el botón de DOS estados que dice en cuál está con `aria-pressed` (una píldora «Disponible»/«Agotada»): píldora (`rounded-full`) con el contorno y el texto del tono del estado — `ok` si está
 *   marcado (`aria-pressed="true"`), `error` con fondo tintado si no — en lugar del relleno de las demás variantes. El estado lo dice el TEXTO que pone quien lo usa; el tono lo refuerza. Va con `tamano="tactil"`
 *   (44 px en cualquier ancho) y, si hace falta un ancho mínimo para que los dos textos midan lo mismo, `min-w-*` en `className`. Deshabilitado (el rol solo mira): `cursor-not-allowed` y 70 % de opacidad.
 * - `tamano="en-fila"`: la acción de texto de una fila de lista o tabla («Desactivar», «Sí, desactivar», «Cancelar»…) y la de la cabecera («Salir»). 44 px de alto en celular y, desde `md:`, la
 *   altura del texto (sin mínimo y sin relleno horizontal): así la fila de escritorio mide lo que medía cuando eran enlaces de texto y el relleno de la celda no se suma a uno de 32 px.
 */
export type VarianteDeBoton = "primario" | "acento" | "secundario" | "peligro" | "enlace" | "enlace-peligro" | "sobre-tinta" | "interruptor";
export type TamanoDeBoton = "normal" | "compacto" | "chico" | "tactil" | "en-fila";

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 aria-busy:cursor-progress aria-busy:opacity-70";

/** El color del contorno del foco va POR VARIANTE: `foco` (la tinta) no se ve sobre un fondo oscuro; `sobre-tinta` usa `foco-sobre-tinta` (blanco). */
const FOCO_DE_LA_VARIANTE: Record<VarianteDeBoton, string> = {
  primario: "focus-visible:outline-foco",
  acento: "focus-visible:outline-foco",
  secundario: "focus-visible:outline-foco",
  peligro: "focus-visible:outline-foco",
  enlace: "focus-visible:outline-foco",
  "enlace-peligro": "focus-visible:outline-foco",
  "sobre-tinta": "focus-visible:outline-foco-sobre-tinta",
  interruptor: "focus-visible:outline-foco",
};

const VARIANTES: Record<VarianteDeBoton, string> = {
  primario: "bg-tinta text-superficie hover:bg-tinta/85",
  acento: "bg-marca text-superficie hover:bg-marca-hover",
  secundario: "border border-borde-control bg-superficie text-tinta hover:bg-superficie-suave",
  peligro: "bg-error text-superficie hover:bg-error/90",
  enlace: "text-tinta-suave underline hover:text-tinta",
  "enlace-peligro": "text-error underline hover:decoration-2",
  // Para un botón sobre un fondo oscuro del sistema (`tinta`, `error`): contorno translúcido, texto blanco y un velo blanco al pasar el mouse.
  "sobre-tinta": "border border-borde-sobre-tinta text-superficie hover:bg-superficie/10",
  // Dos estados por `aria-pressed`: marcado, contorno y texto `ok`; sin marcar, contorno y texto `error` sobre su tinte.
  interruptor: "border aria-pressed:border-ok aria-pressed:text-ok-tinta not-aria-pressed:border-error not-aria-pressed:bg-error-tinte not-aria-pressed:text-error",
};

/** La forma del botón (el radio del borde): `rounded` para todos, píldora para el interruptor. Va por variante para que no se pisen dos radios en la misma clase. */
const FORMA: Record<VarianteDeBoton, string> = {
  primario: "rounded",
  acento: "rounded",
  secundario: "rounded",
  peligro: "rounded",
  enlace: "rounded",
  "enlace-peligro": "rounded",
  "sobre-tinta": "rounded",
  interruptor: "rounded-full",
};

/** Cómo se ve deshabilitado: atenuado (50 %) para todos; el interruptor, que el rol de solo lectura ve sin poder tocarlo, al 70 % y con el cursor de «no permitido». */
const DESHABILITADO: Record<VarianteDeBoton, string> = {
  primario: "disabled:opacity-50",
  acento: "disabled:opacity-50",
  secundario: "disabled:opacity-50",
  peligro: "disabled:opacity-50",
  enlace: "disabled:opacity-50",
  "enlace-peligro": "disabled:opacity-50",
  "sobre-tinta": "disabled:opacity-50",
  interruptor: "disabled:cursor-not-allowed disabled:opacity-70",
};

const TAMANOS: Record<TamanoDeBoton, string> = {
  normal: "min-h-11 px-4 text-sm md:min-h-9 md:px-3",
  compacto: "min-h-11 px-3 text-sm md:min-h-8",
  chico: "min-h-11 px-2 text-xs md:min-h-7",
  // 44 px SIEMPRE, también en escritorio: para lo que debe cumplir la zona táctil en cualquier ancho (el aviso flotante con «Deshacer»).
  tactil: "min-h-11 px-3 text-sm",
  // La acción de texto de una fila: 44 px en celular y, desde `md:`, la altura del texto (`md:min-h-0`), sin relleno horizontal (el espacio entre acciones lo da el contenedor).
  "en-fila": "min-h-11 text-sm md:min-h-0",
};

export function claseDeBoton(variante: VarianteDeBoton = "primario", tamano: TamanoDeBoton = "normal"): string {
  return `${BASE} ${FORMA[variante]} ${DESHABILITADO[variante]} ${FOCO_DE_LA_VARIANTE[variante]} ${VARIANTES[variante]} ${TAMANOS[tamano]}`;
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
