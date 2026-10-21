import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * Campo de formulario con su etiqueta, ayuda, lectura y error ya conectados (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * Dos piezas:
 *  - `EnvolturaDeCampo`: todo lo que rodea a un control (etiqueta atada con `htmlFor`, ayuda, lectura en vivo y error) y lo que el control tiene que llevar para estar conectado (su `id`,
 *    `aria-describedby`, `aria-invalid` y la clase de su aspecto). La usan `Campo` y, en pasos siguientes, `Selector` y `AreaDeTexto`: un solo lugar decide cómo se anuncia un error.
 *  - `Campo`: la envoltura con un `<input>` adentro.
 *
 * Reglas de accesibilidad (las cumple la envoltura, no cada pantalla):
 *  - La etiqueta es obligatoria y va atada al control (`htmlFor`): un control sin nombre no existe para un lector de pantalla. Con `etiquetaOculta` se ve solo para lectores (`sr-only`), pero está.
 *  - La ayuda, la lectura y el error van FUERA del `<label>` (si fueran parte de la etiqueta, el lector de pantalla los leería como parte del nombre del control, y el error dos veces). Se anuncian con
 *    `aria-describedby`; el error, además, con `role="alert"` y el control con `aria-invalid`. El error aparece UNA sola vez. Dice cómo corregirlo (lo escribe quien lo usa).
 *  - 16 px en celular (`text-base`: iOS no hace zoom al enfocar) y 44 px de alto táctil; desde `md:` baja al tamaño compacto del escritorio.
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04).
 */

export type TamanoDeCampo = "normal" | "compacto";

/** Lo que la envoltura le pide al control que lleve puesto. */
export interface AtributosDeControl {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  /** El aspecto compartido (borde, fondo, tinta, foco, deshabilitado); la altura la agrega cada control según su tamaño. */
  className: string;
}

interface PropsDeEnvolturaDeCampo {
  /** El `id` del control; si no viene se genera uno. Dos campos en la misma pantalla nunca comparten id. */
  id?: string;
  etiqueta: ReactNode;
  /** La etiqueta solo para lectores de pantalla (el campo ya tiene su rótulo en otro lado, por ejemplo la cabecera de una columna). */
  etiquetaOculta?: boolean;
  /** Marca la etiqueta con un asterisco decorativo (no se lee dos veces: el control lleva `required`). */
  requerido?: boolean;
  /** Texto fijo bajo el control (no desaparece al tipear, a diferencia de un placeholder). */
  ayuda?: ReactNode;
  /** Texto que el sistema calcula a partir de lo tipeado («En la carta se verá: …»); se anuncia con cortesía (`aria-live="polite"`). */
  lectura?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el control queda marcado como inválido. */
  error?: ReactNode;
  /** Dibuja el control con lo que la envoltura le pide que lleve. */
  children: (control: AtributosDeControl) => ReactNode;
}

const ASPECTO_DEL_CONTROL =
  "w-full rounded border bg-superficie px-3 text-base text-tinta focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foco disabled:bg-superficie-suave disabled:text-tinta-tenue md:text-sm";

export function EnvolturaDeCampo({ id, etiqueta, etiquetaOculta = false, requerido = false, ayuda, lectura, error, children }: PropsDeEnvolturaDeCampo) {
  const generado = useId();
  const idControl = id ?? generado;
  const idAyuda = `${idControl}-ayuda`;
  const idLectura = `${idControl}-lectura`;
  const idError = `${idControl}-error`;
  const descripcion = [ayuda ? idAyuda : null, lectura ? idLectura : null, error ? idError : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idControl} className={etiquetaOculta ? "sr-only" : "text-sm font-medium"}>
        {etiqueta}
        {requerido ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children({
        id: idControl,
        "aria-describedby": descripcion,
        "aria-invalid": error ? true : undefined,
        className: `${ASPECTO_DEL_CONTROL} ${error ? "border-error" : "border-borde-control"}`,
      })}
      {ayuda ? (
        <p id={idAyuda} className="text-xs text-tinta-suave">
          {ayuda}
        </p>
      ) : null}
      {lectura ? (
        <p id={idLectura} aria-live="polite" className="text-sm text-tinta">
          {lectura}
        </p>
      ) : null}
      {error ? (
        <p id={idError} role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const ALTURA_DEL_CAMPO: Record<TamanoDeCampo, string> = {
  normal: "min-h-11 md:min-h-9",
  compacto: "min-h-11 md:min-h-8",
};

export interface PropsDeCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  etiqueta: ReactNode;
  etiquetaOculta?: boolean;
  /** Texto fijo bajo el campo (no desaparece al tipear, a diferencia de un placeholder). */
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el campo queda marcado como inválido. */
  error?: ReactNode;
  tamano?: TamanoDeCampo;
  id?: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<input>`. */
  ref?: Ref<HTMLInputElement>;
}

// @contrato primitiva-campo
export function Campo({ etiqueta, etiquetaOculta, ayuda, error, tamano = "normal", id, className, required, ref, ...resto }: PropsDeCampo) {
  return (
    <EnvolturaDeCampo id={id} etiqueta={etiqueta} etiquetaOculta={etiquetaOculta} requerido={required} ayuda={ayuda} error={error}>
      {(control) => <input {...resto} {...control} ref={ref} required={required} className={`${control.className} ${ALTURA_DEL_CAMPO[tamano]}${className ? ` ${className}` : ""}`} />}
    </EnvolturaDeCampo>
  );
}
