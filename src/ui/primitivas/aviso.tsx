import type { HTMLAttributes, ReactNode, Ref } from "react";

/**
 * Aviso al usuario: un mensaje de éxito, advertencia, error o información (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - `variante` dice QUÉ pasó y de ahí salen el tono y el rol, que no se eligen por separado: un error es `role="alert"` (se anuncia al instante, interrumpe) y el resto `role="status"` (se anuncia
 *   con cortesía, sin interrumpir). Quien lo usa no puede poner `role`: el tipo se lo impide.
 * - `forma` dice CÓMO se ve: `caja` (por defecto: recuadro con fondo tintado y borde), `en-linea` (solo el texto en el color del tono, para el pie de un formulario o al lado de un botón) o
 *   `flotante` (la barra oscura de un aviso con «Deshacer»: fondo `tinta`, o `error` si falló, y texto blanco; el tipo no deja la advertencia flotante). La PRIMITIVA no se posiciona: quien la usa la
 *   pone dentro de un envoltorio que la ubica (`fixed`, ancho…), porque la regla `primitivas-sin-clases-de-presentacion` no deja pasar clases de ubicación por `className`. Los botones de una barra
 *   flotante son `Boton variante="sobre-tinta"`.
 * - El color nunca es lo único que lo dice: el texto lo dice quien lo usa, y el tono es el refuerzo. Cada par texto/fondo está medido en `test/arquitectura/tokens-del-sistema-visual.test.ts` (>= 4,5:1).
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04). Acepta `ref` (React 19: una prop más).
 */
export type VarianteDeAviso = "exito" | "advertencia" | "error" | "informacion";
/** Las variantes que puede tener la forma `flotante`: sin `advertencia` (el ámbar no tiene un par con el texto blanco que llegue a 4,5:1). */
export type VarianteDeAvisoFlotante = Exclude<VarianteDeAviso, "advertencia">;
export type FormaDeAviso = "en-linea" | "caja";

interface PropsBaseDeAviso extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  children: ReactNode;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<div>`. */
  ref?: Ref<HTMLDivElement>;
}

/** `forma` en-linea|caja admite las cuatro variantes; `flotante` solo éxito, error e información. */
export type PropsDeAviso = PropsBaseDeAviso &
  (
    | { variante: VarianteDeAviso; forma?: FormaDeAviso }
    | { variante: VarianteDeAvisoFlotante; forma: "flotante" }
  );

/** El rol de cada variante: solo el error interrumpe. */
const ROL_DE_LA_VARIANTE: Record<VarianteDeAviso, "alert" | "status"> = {
  exito: "status",
  advertencia: "status",
  error: "alert",
  informacion: "status",
};

/** El tono de cada variante, por forma: el color del texto y, en la caja, el fondo tintado y el borde. */
const TONO_DE_LA_VARIANTE: Record<VarianteDeAviso, Record<FormaDeAviso, string>> = {
  exito: { "en-linea": "text-ok-tinta", caja: "border-ok bg-ok-tinte text-ok-tinta" },
  advertencia: { "en-linea": "text-aviso-tinta", caja: "border-aviso bg-aviso-tinte text-aviso-tinta" },
  error: { "en-linea": "text-error", caja: "border-error bg-error-tinte text-error" },
  informacion: { "en-linea": "text-tinta-suave", caja: "border-borde bg-superficie-suave text-tinta-suave" },
};

/** El tono de la forma flotante: la barra es `tinta` (éxito e información) o `error`; el texto, blanco, va en la base. */
const TONO_FLOTANTE: Record<VarianteDeAvisoFlotante, string> = {
  exito: "bg-tinta",
  informacion: "bg-tinta",
  error: "bg-error",
};

const BASE_DE_LA_FORMA: Record<FormaDeAviso | "flotante", string> = {
  "en-linea": "text-sm",
  caja: "rounded border px-3 py-2 text-sm",
  flotante: "flex items-center gap-3 px-3.5 py-3 text-sm text-superficie shadow-lg shadow-sombra",
};

// @contrato primitiva-aviso
export function Aviso({ variante, forma = "caja", className, children, ref, ...resto }: PropsDeAviso) {
  // El tipo ya impide `flotante` con `advertencia`; el cast solo reparte la unión que la desestructuración separó.
  const tono = forma === "flotante" ? TONO_FLOTANTE[variante as VarianteDeAvisoFlotante] : TONO_DE_LA_VARIANTE[variante][forma];
  return (
    <div {...resto} ref={ref} role={ROL_DE_LA_VARIANTE[variante]} className={`${BASE_DE_LA_FORMA[forma]} ${tono}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
