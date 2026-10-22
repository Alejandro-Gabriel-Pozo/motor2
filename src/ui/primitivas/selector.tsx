import type { ReactNode, Ref, SelectHTMLAttributes } from "react";
import { ALTURA_DEL_CAMPO, EnvolturaDeCampo, type TamanoDeCampo } from "./campo";

/**
 * Selector (`<select>` nativo) con su etiqueta, ayuda y error ya conectados (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * Es `Campo` con otro control: la misma `EnvolturaDeCampo` (etiqueta atada con `htmlFor`, ayuda con `aria-describedby`, error UNA sola vez con `role="alert"` y fuera de la etiqueta,
 * `aria-invalid`), el mismo aspecto de tokens y la misma altura (44 px en celular, compacta desde `md:`). La etiqueta es OBLIGATORIA (el tipo no deja omitirla): un selector sin
 * nombre no existe para un lector de pantalla; con `etiquetaOculta` se ve solo para lectores.
 *
 * El control es el `<select>` NATIVO: en celular el sistema abre su propia hoja con la rueda y en PC su lista, con teclado y accesibilidad incluidos. Las opciones (`<option>`) las pone
 * quien lo usa como hijos.
 */
interface PropsDeSelector extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  /** Obligatoria. */
  etiqueta: ReactNode;
  etiquetaOculta?: boolean;
  /** Texto fijo bajo el selector. */
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el selector queda marcado como inválido. */
  error?: ReactNode;
  tamano?: TamanoDeCampo;
  id?: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<select>`. */
  ref?: Ref<HTMLSelectElement>;
}

// @contrato primitiva-selector
export function Selector({ etiqueta, etiquetaOculta, ayuda, error, tamano = "normal", id, className, required, ref, children, ...resto }: PropsDeSelector) {
  return (
    <EnvolturaDeCampo id={id} etiqueta={etiqueta} etiquetaOculta={etiquetaOculta} requerido={required} ayuda={ayuda} error={error}>
      {(control) => (
        <select {...resto} {...control} ref={ref} required={required} className={`${control.className} ${ALTURA_DEL_CAMPO[tamano]}${className ? ` ${className}` : ""}`}>
          {children}
        </select>
      )}
    </EnvolturaDeCampo>
  );
}
