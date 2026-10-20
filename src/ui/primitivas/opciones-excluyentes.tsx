import { useId, type ReactNode } from "react";

/**
 * Un grupo de opciones EXCLUYENTES (radios) con su leyenda (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - `fieldset` + `legend`: el lector de pantalla anuncia la pregunta al entrar al grupo; las flechas se mueven entre las opciones (comportamiento nativo de los radios con el mismo `name`).
 * - Cada opción con su etiqueta atada (`htmlFor`) y, si la tiene, su ayuda (`aria-describedby`). Una opción DESHABILITADA dice por qué (`motivo`, visible y conectado con `aria-describedby`):
 *   un control apagado sin explicación no le sirve a nadie.
 * - Sin colores propios: el texto hereda del contenedor (los tokens llegan con la Fase 6).
 */
export interface OpcionExcluyente {
  valor: string;
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  deshabilitada?: boolean;
  /** Por qué está deshabilitada (se muestra y se anuncia). */
  motivo?: ReactNode;
}

export interface PropsDeOpcionesExcluyentes {
  leyenda: ReactNode;
  /** El `name` de los radios (lo que viaja en el formulario). */
  nombre: string;
  opciones: readonly OpcionExcluyente[];
  /** La elegida al abrir (no controlado: el formulario la lee al enviar). */
  valorInicial?: string;
  /** Avisa cada cambio (para que quien lo usa muestre u oculte lo que dependa de la elección). */
  alCambiar?: (valor: string) => void;
}

export function OpcionesExcluyentes({ leyenda, nombre, opciones, valorInicial, alCambiar }: PropsDeOpcionesExcluyentes) {
  const base = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{leyenda}</legend>
      {opciones.map((o, i) => {
        const id = `${base}-${i}`;
        const idAyuda = `${id}-ayuda`;
        const idMotivo = `${id}-motivo`;
        const describedBy = [o.ayuda ? idAyuda : null, o.deshabilitada && o.motivo ? idMotivo : null].filter(Boolean).join(" ") || undefined;
        return (
          <div key={o.valor} className="flex items-start gap-2">
            <input
              type="radio"
              id={id}
              name={nombre}
              value={o.valor}
              defaultChecked={valorInicial === o.valor}
              disabled={o.deshabilitada}
              aria-describedby={describedBy}
              onChange={alCambiar ? (e) => e.target.checked && alCambiar(o.valor) : undefined}
              className="mt-1 h-4 w-4"
            />
            <div className="flex flex-col">
              <label htmlFor={id} className="text-sm">
                {o.etiqueta}
              </label>
              {o.ayuda ? (
                <span id={idAyuda} className="text-xs">
                  {o.ayuda}
                </span>
              ) : null}
              {o.deshabilitada && o.motivo ? (
                <span id={idMotivo} className="text-xs">
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
