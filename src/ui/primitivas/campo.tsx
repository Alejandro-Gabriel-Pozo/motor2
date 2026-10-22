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
 *  - El control SIEMPRE tiene nombre, y el tipo exige UNA de tres formas (`NombreDeCampo`): `etiqueta` (la envoltura dibuja el `<label htmlFor>`; con `etiquetaOculta` se ve solo para lectores,
 *    `sr-only`, pero está), `aria-label` (el nombre es un texto y no hay `<label>`) o `nombradoPorFuera` (el nombre lo pone un `<label>` que envuelve al campo o atado por `htmlFor`: la envoltura no
 *    dibuja otro, que quedaría anidado). Un control sin nombre no existe para un lector de pantalla; la regla `campos-con-nombre` verifica que `nombradoPorFuera` y `CampoNumero` lo cumplan.
 *  - La ayuda, la lectura y el error van FUERA del `<label>` (si fueran parte de la etiqueta, el lector de pantalla los leería como parte del nombre del control, y el error dos veces). Se anuncian con
 *    `aria-describedby`; el error, además, con `role="alert"` y el control con `aria-invalid`. El error aparece UNA sola vez. Dice cómo corregirlo (lo escribe quien lo usa).
 *  - `invalido` marca el campo (`aria-invalid` y borde de error) SIN mensaje: para quien ya muestra o frena el problema por otro lado (la validez nativa de `CampoNumero`). Con `error` sobra: el mensaje
 *    ya lo marca. Un campo marcado sin que nadie diga por qué no se anuncia con `role="alert"`.
 *  - 16 px en celular (`text-base`: iOS no hace zoom al enfocar) y 44 px de alto táctil; desde `md:` baja al tamaño compacto del escritorio.
 *  - `alinear="fin"` alinea el texto a la derecha (números) y `prefijo` pone un símbolo («$») al comienzo, dentro del campo, fuera del valor editable: es decorativo para quien ve y el lector de pantalla
 *    lo lee como parte del contenido cercano (no lleva `aria-hidden`).
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
  /** El rótulo. Si falta, la envoltura no dibuja `<label>` (el control se nombra con `aria-label` o con una etiqueta de afuera: `Campo` lo exige en su tipo). */
  etiqueta?: ReactNode;
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
  /** Marca el control como inválido (`aria-invalid` y borde de error) SIN dibujar ningún mensaje. Con `error` sobra. */
  invalido?: boolean;
  /** Dibuja el control con lo que la envoltura le pide que lleve. */
  children: (control: AtributosDeControl) => ReactNode;
}

const ASPECTO_DEL_CONTROL =
  "w-full rounded border bg-superficie px-3 text-base text-tinta focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foco disabled:bg-superficie-suave disabled:text-tinta-tenue md:text-sm";

export function EnvolturaDeCampo({ id, etiqueta, etiquetaOculta = false, requerido = false, ayuda, lectura, error, invalido = false, children }: PropsDeEnvolturaDeCampo) {
  const generado = useId();
  const idControl = id ?? generado;
  const idAyuda = `${idControl}-ayuda`;
  const idLectura = `${idControl}-lectura`;
  const idError = `${idControl}-error`;
  const descripcion = [ayuda ? idAyuda : null, lectura ? idLectura : null, error ? idError : null].filter(Boolean).join(" ") || undefined;
  const marcado = Boolean(error) || invalido;
  return (
    <div className="flex flex-col gap-1">
      {etiqueta != null ? (
        <label htmlFor={idControl} className={etiquetaOculta ? "sr-only" : "text-sm font-medium"}>
          {etiqueta}
          {requerido ? <span aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children({
        id: idControl,
        "aria-describedby": descripcion,
        "aria-invalid": marcado ? true : undefined,
        className: `${ASPECTO_DEL_CONTROL} ${marcado ? "border-error" : "border-borde-control"}`,
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

/** El alto de un control de una línea por tamaño: 44 px en celular y el del escritorio desde `md:`. Lo comparten `Campo` y `Selector`. */
export const ALTURA_DEL_CAMPO: Record<TamanoDeCampo, string> = {
  normal: "min-h-11 md:min-h-9",
  compacto: "min-h-11 md:min-h-8",
};

/**
 * Cómo se nombra un campo: EXACTAMENTE una de tres formas (las otras dos quedan en `never`, así que mezclarlas o no poner ninguna no compila).
 *  - `etiqueta` (con `etiquetaOculta` opcional): la envoltura dibuja el `<label htmlFor>`;
 *  - `aria-label`: el nombre es este texto y no hay `<label>`;
 *  - `nombradoPorFuera`: otro `<label>` lo envuelve o lo ata con `htmlFor` (la envoltura no dibuja el suyo). No llega al DOM.
 */
export type NombreDeCampo =
  | { etiqueta: ReactNode; etiquetaOculta?: boolean; "aria-label"?: never; nombradoPorFuera?: never }
  | { "aria-label": string; etiqueta?: never; etiquetaOculta?: never; nombradoPorFuera?: never }
  | { nombradoPorFuera: true; etiqueta?: never; etiquetaOculta?: never; "aria-label"?: never };

/** Todo lo de un campo menos cómo se nombra (`aria-label` se omite del `<input>` porque lo gobierna `NombreDeCampo`). */
export interface PropsBaseDeCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-label"> {
  /** Texto fijo bajo el campo (no desaparece al tipear, a diferencia de un placeholder). */
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado para el usuario; si viene, el campo queda marcado como inválido. */
  error?: ReactNode;
  /** Marca el campo como inválido (`aria-invalid` y borde de error) SIN mensaje ni `role="alert"`: para quien ya muestra o frena el problema por otro lado. Con `error` sobra. */
  invalido?: boolean;
  /** `fin` alinea el texto a la derecha (números); `inicio` (por defecto) lo deja a la izquierda. */
  alinear?: "inicio" | "fin";
  /** Símbolo al comienzo del campo («$»), dentro de él y fuera del valor editable. El campo deja lugar para el símbolo. */
  prefijo?: string;
  tamano?: TamanoDeCampo;
  id?: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<input>`. */
  ref?: Ref<HTMLInputElement>;
}

export type PropsDeCampo = PropsBaseDeCampo & NombreDeCampo;

const SIMBOLO_DEL_PREFIJO = "pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-tinta-suave";

// @contrato primitiva-campo
export function Campo({ etiqueta, etiquetaOculta, nombradoPorFuera, ayuda, error, invalido, alinear = "inicio", prefijo, tamano = "normal", id, className, required, ref, ...resto }: PropsDeCampo) {
  // `nombradoPorFuera` solo le dice al tipo que el nombre lo pone otro: no es un atributo del `<input>`, no tiene que llegar al DOM.
  void nombradoPorFuera;
  return (
    <EnvolturaDeCampo id={id} etiqueta={etiqueta} etiquetaOculta={etiquetaOculta} requerido={required} ayuda={ayuda} error={error} invalido={invalido}>
      {(control) => {
        const clases = [control.className, ALTURA_DEL_CAMPO[tamano], alinear === "fin" ? "text-right" : null, prefijo ? "pl-5" : null, className].filter(Boolean).join(" ");
        const entrada = <input {...resto} {...control} ref={ref} required={required} className={clases} />;
        if (!prefijo) return entrada;
        return (
          <div className="relative">
            <span className={SIMBOLO_DEL_PREFIJO}>{prefijo}</span>
            {entrada}
          </div>
        );
      }}
    </EnvolturaDeCampo>
  );
}
