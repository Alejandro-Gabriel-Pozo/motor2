import { useId, type ReactNode } from "react";

/**
 * Un grupo de opciones EXCLUYENTES (radios) con su leyenda (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - `fieldset` + `legend`: el lector de pantalla anuncia la pregunta al entrar al grupo; las flechas se mueven entre las opciones (comportamiento nativo de los radios con el mismo `name`).
 * - Cada opción con su etiqueta atada (`htmlFor`) y, si la tiene, su ayuda (`aria-describedby`). Una opción DESHABILITADA dice por qué (`motivo`, visible y conectado con `aria-describedby`):
 *   un control apagado sin explicación no le sirve a nadie.
 * - Dos presentaciones (`presentacion`): `lista` (por defecto: una opción debajo de la otra, sin recuadro; es la que usan las pantallas de hoy) y `tarjetas` (cada opción es un recuadro de
 *   44 px de alto como mínimo que se toca entero, con el borde de la elegida marcado). Es la MISMA primitiva: el fieldset, la leyenda, las etiquetas atadas y los motivos no cambian.
 * - La presentación `lista` no trae colores propios: el texto hereda del contenedor. Las `tarjetas` usan solo tokens del sistema visual (src/app/globals.css), sin modo oscuro (DEC-04).
 */
export interface OpcionExcluyente {
  valor: string;
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  deshabilitada?: boolean;
  /** Por qué está deshabilitada (se muestra y se anuncia). */
  motivo?: ReactNode;
}

export type PresentacionDeOpciones = "lista" | "tarjetas";

export interface PropsDeOpcionesExcluyentes {
  leyenda: ReactNode;
  /** El `name` de los radios (lo que viaja en el formulario). */
  nombre: string;
  opciones: readonly OpcionExcluyente[];
  /** La elegida al abrir (no controlado: el formulario la lee al enviar). */
  valorInicial?: string;
  /** Avisa cada cambio (para que quien lo usa muestre u oculte lo que dependa de la elección). */
  alCambiar?: (valor: string) => void;
  /** Cómo se dibujan las opciones; `lista` por defecto (lo que ya usan las pantallas). */
  presentacion?: PresentacionDeOpciones;
}

export function OpcionesExcluyentes({ leyenda, nombre, opciones, valorInicial, alCambiar, presentacion = "lista" }: PropsDeOpcionesExcluyentes) {
  const base = useId();
  const tarjetas = presentacion === "tarjetas";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={tarjetas ? "text-sm font-medium text-tinta" : "text-sm font-medium"}>{leyenda}</legend>
      {opciones.map((o, i) => {
        const id = `${base}-${i}`;
        const idAyuda = `${id}-ayuda`;
        const idMotivo = `${id}-motivo`;
        const describedBy = [o.ayuda ? idAyuda : null, o.deshabilitada && o.motivo ? idMotivo : null].filter(Boolean).join(" ") || undefined;
        return (
          <div
            key={o.valor}
            className={
              tarjetas
                ? "relative flex min-h-11 items-start gap-2 rounded border border-borde-control bg-superficie p-3 text-tinta has-checked:border-tinta has-checked:bg-superficie-suave has-disabled:bg-superficie-suave has-disabled:text-tinta-suave md:min-h-9"
                : "flex items-start gap-2"
            }
          >
            <input
              type="radio"
              id={id}
              name={nombre}
              value={o.valor}
              defaultChecked={valorInicial === o.valor}
              disabled={o.deshabilitada}
              aria-describedby={describedBy}
              onChange={alCambiar ? (e) => e.target.checked && alCambiar(o.valor) : undefined}
              className={tarjetas ? "mt-1 h-4 w-4 accent-tinta" : "mt-1 h-4 w-4"}
            />
            <div className="flex flex-col">
              <label htmlFor={id} className={tarjetas ? "text-sm after:absolute after:inset-0" : "text-sm"}>
                {o.etiqueta}
              </label>
              {o.ayuda ? (
                <span id={idAyuda} className={tarjetas ? "text-xs text-tinta-suave" : "text-xs"}>
                  {o.ayuda}
                </span>
              ) : null}
              {o.deshabilitada && o.motivo ? (
                <span id={idMotivo} className={tarjetas ? "text-xs text-tinta-suave" : "text-xs"}>
                  {o.motivo}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
