import { AYUDAS_FIJAS_VISIBLES } from "@/core/textos/ayudas-fijas-visibles";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * Casilla de verificación (`<input type="checkbox">`) con su etiqueta, ayuda y error ya conectados (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * Es el hermano de `Campo` para un control de sí o no, y cumple lo mismo:
 *  - La etiqueta es obligatoria y va atada a la casilla (`htmlFor`/`id`): un control sin nombre no existe para un lector de pantalla, y tocar el texto también tilda la casilla.
 *  - La ayuda y el error van FUERA de la etiqueta y se anuncian con `aria-describedby`; el error, además, con `role="alert"` (UNA sola vez) y la casilla con `aria-invalid`.
 *  - 44 px de alto táctil en celular (la fila entera, no solo el cuadradito) y el alto del escritorio desde `md:`. La etiqueta se extiende por DEBAJO del cuadradito (`-ml-7 pl-7`: 20 px del dibujo + 8 de
 *    separación; el cuadradito va encima, `relative z-10` dentro de la fila aislada con `isolate`, para que un clic o `check()` sobre él le llegue a él y no a la etiqueta), así que tocar el cuadradito o el aire que lo rodea también tilda: el área táctil mide 44 px de alto en toda la fila sin agrandar el dibujo.
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04). Lo que la casilla dibuja (tilde, color al marcar) lo pone el navegador con `accent-tinta`.
 */
export interface PropsDeCasilla extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  /** Obligatoria: el texto que se lee y se toca. */
  etiqueta: ReactNode;
  /** Texto fijo bajo la casilla. */
  ayuda?: ReactNode;
  /** Aviso CONDICIONAL bajo el control (un permiso que falta, un estado): se dibuja SIEMPRE, no depende de `AYUDAS_FIJAS_VISIBLES`; `ayuda` es el texto fijo y sí depende. */
  aviso?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, la casilla queda marcada como inválida. */
  error?: ReactNode;
  /** El `id` de la casilla; si no viene se genera uno. Dos casillas en la misma pantalla nunca comparten id. */
  id?: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<input>`. */
  ref?: Ref<HTMLInputElement>;
}

// @contrato primitiva-casilla
export function Casilla({ etiqueta, ayuda, aviso, error, id, className, ref, ...resto }: PropsDeCasilla) {
  const generado = useId();
  const idCasilla = id ?? generado;
  const idAyuda = `${idCasilla}-ayuda`;
  const idAviso = `${idCasilla}-aviso`;
  const ayudaVisible = AYUDAS_FIJAS_VISIBLES ? ayuda : null;
  const idError = `${idCasilla}-error`;
  const descripcion = [ayudaVisible ? idAyuda : null, aviso ? idAviso : null, error ? idError : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="isolate flex min-h-11 items-center gap-2 md:min-h-9">
        <input
          {...resto}
          ref={ref}
          id={idCasilla}
          type="checkbox"
          aria-describedby={descripcion}
          aria-invalid={error ? true : undefined}
          className={`peer relative z-10 h-5 w-5 shrink-0 rounded border ${error ? "border-error" : "border-borde-control"} bg-superficie text-tinta accent-tinta focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foco disabled:bg-superficie-suave${className ? ` ${className}` : ""}`}
        />
        <label htmlFor={idCasilla} className="-ml-7 flex min-h-11 flex-1 items-center pl-7 text-sm text-tinta peer-disabled:text-tinta-tenue md:min-h-9">
          {etiqueta}
        </label>
      </div>
      {ayudaVisible ? (
        <p id={idAyuda} className="text-xs text-tinta-suave">
          {ayudaVisible}
        </p>
      ) : null}
      {aviso ? (
        <p id={idAviso} className="text-xs text-tinta-suave">
          {aviso}
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
