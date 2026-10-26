import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { ALTURA_DEL_CAMPO, EnvolturaDeCampo, type TamanoDeCampo } from "./campo";

/**
 * Área de texto (`<textarea>`) con su etiqueta, ayuda y error ya conectados (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * Es `Campo` con otro control: la misma `EnvolturaDeCampo` (etiqueta obligatoria y atada con `htmlFor`, ayuda con `aria-describedby`, error UNA sola vez con `role="alert"` y fuera de la
 * etiqueta, `aria-invalid`), el mismo aspecto de tokens y el mismo piso de altura (44 px en celular, el del escritorio desde `md:`); lo que la hace más alta son sus filas (`rows`, 3 por
 * defecto) y se puede agrandar hacia abajo (`resize-y`). 16 px en celular: iOS no hace zoom al enfocar.
 */
interface PropsDeAreaDeTexto extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  /** Obligatoria. */
  etiqueta: ReactNode;
  etiquetaOculta?: boolean;
  /** Texto fijo bajo el área (no desaparece al tipear, a diferencia de un placeholder). */
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el área queda marcada como inválida. */
  error?: ReactNode;
  tamano?: TamanoDeCampo;
  id?: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<textarea>`. */
  ref?: Ref<HTMLTextAreaElement>;
}

// @contrato primitiva-area-de-texto
export function AreaDeTexto({ etiqueta, etiquetaOculta, ayuda, error, tamano = "normal", id, className, required, rows = 3, ref, ...resto }: PropsDeAreaDeTexto) {
  return (
    <EnvolturaDeCampo id={id} etiqueta={etiqueta} etiquetaOculta={etiquetaOculta} requerido={required} ayuda={ayuda} error={error}>
      {(control) => <textarea {...resto} {...control} ref={ref} rows={rows} required={required} className={`${control.className} ${ALTURA_DEL_CAMPO[tamano]} resize-y py-2${className ? ` ${className}` : ""}`} />}
    </EnvolturaDeCampo>
  );
}
