import type { HTMLAttributes, ReactNode, Ref } from "react";

/**
 * Aviso al usuario: un mensaje de éxito, advertencia, error o información (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - `variante` dice QUÉ pasó y de ahí salen el tono y el rol, que no se eligen por separado: un error es `role="alert"` (se anuncia al instante, interrumpe) y el resto `role="status"` (se anuncia
 *   con cortesía, sin interrumpir). Quien lo usa no puede poner `role`: el tipo se lo impide.
 * - `forma` dice CÓMO se ve: `caja` (por defecto: recuadro con fondo tintado y borde) o `en-linea` (solo el texto en el color del tono, para el pie de un formulario o al lado de un botón).
 * - El color nunca es lo único que lo dice: el texto lo dice quien lo usa, y el tono es el refuerzo. Cada par texto/fondo está medido en `test/arquitectura/tokens-del-sistema-visual.test.ts` (>= 4,5:1).
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04). Acepta `ref` (React 19: una prop más).
 */
export type VarianteDeAviso = "exito" | "advertencia" | "error" | "informacion";
export type FormaDeAviso = "en-linea" | "caja";

export interface PropsDeAviso extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  variante: VarianteDeAviso;
  forma?: FormaDeAviso;
  children: ReactNode;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<div>`. */
  ref?: Ref<HTMLDivElement>;
}

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

const BASE_DE_LA_FORMA: Record<FormaDeAviso, string> = {
  "en-linea": "text-sm",
  caja: "rounded border px-3 py-2 text-sm",
};

// @contrato primitiva-aviso
export function Aviso({ variante, forma = "caja", className, children, ref, ...resto }: PropsDeAviso) {
  return (
    <div {...resto} ref={ref} role={ROL_DE_LA_VARIANTE[variante]} className={`${BASE_DE_LA_FORMA[forma]} ${TONO_DE_LA_VARIANTE[variante][forma]}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
