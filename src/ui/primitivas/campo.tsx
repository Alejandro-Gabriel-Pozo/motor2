import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Campo de texto con su etiqueta, ayuda y error ya conectados (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - La etiqueta es obligatoria y va atada al campo (`htmlFor`): un campo sin nombre no existe para un lector de pantalla.
 * - La ayuda y el error se anuncian con `aria-describedby`; con error, `aria-invalid` y el mensaje con `role="alert"`. El error dice cómo corregirlo (lo escribe quien lo usa).
 * - 16 px en celular (`text-base`: iOS no hace zoom al enfocar) y 44 px de alto táctil; en pantallas anchas baja a la compacta.
 */
export interface PropsDeCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  etiqueta: ReactNode;
  /** Texto fijo bajo el campo (no desaparece al tipear, a diferencia de un placeholder). */
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el campo queda marcado como inválido. */
  error?: ReactNode;
  id?: string;
}

const CLASE_CAMPO =
  "min-h-11 w-full rounded border bg-white px-3 text-base text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 disabled:opacity-60 sm:min-h-9 sm:text-sm dark:bg-neutral-900 dark:text-neutral-100 dark:focus-visible:outline-neutral-100";

export function Campo({ etiqueta, ayuda, error, id, className, required, ...resto }: PropsDeCampo) {
  const generado = useId();
  const idCampo = id ?? generado;
  const idAyuda = `${idCampo}-ayuda`;
  const idError = `${idCampo}-error`;
  const describedBy = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idCampo} className="text-sm font-medium">
        {etiqueta}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        {...resto}
        id={idCampo}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${CLASE_CAMPO} ${error ? "border-red-700" : "border-neutral-400 dark:border-neutral-600"}${className ? ` ${className}` : ""}`}
      />
      {ayuda ? (
        <p id={idAyuda} className="text-xs text-neutral-600 dark:text-neutral-400">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
