import type { ReactNode } from "react";
import { Campo, type PropsDeCampo } from "@/ui/primitivas/campo";

/**
 * Selector de fecha y de rango de fechas del sistema de diseño (capa `ui/componentes`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * Son componentes de SERVIDOR, sin JavaScript, a propósito (restricción heredada de `components/selector-rango.tsx`: evita que un valor viejo viaje en el envío). El control es el
 * `<input type="date">` NATIVO: en PC el navegador lo abre como popover y en celular como hoja con la rueda del sistema, así que ya cumple «popover en PC, hoja en celular»
 * con su teclado y su accesibilidad incluidos. Una mejora progresiva con JavaScript (calendario propio) se puede sumar encima sin cambiar este contrato.
 *
 * Las fechas son TEXTO `AAAA-MM-DD` (lo que manda el input), nunca `Date`: así no hay corrimiento por zona horaria entre el navegador y el servidor. `min` y `max` guían al selector
 * del navegador, pero NO son una validación: el servidor sigue siendo quien decide si el rango es válido.
 */
export function CampoFecha(props: Omit<PropsDeCampo, "type">) {
  return <Campo {...props} type="date" />;
}

export interface PropsDeRangoDeFechas {
  /** Nombre del grupo para el lector de pantalla y para quien lo ve («Período», «Fechas de la compra»…). */
  leyenda: string;
  desde: { name: string; defaultValue?: string; etiqueta?: string };
  hasta: { name: string; defaultValue?: string; etiqueta?: string };
  /** Límite inferior y superior permitidos para las dos fechas, `AAAA-MM-DD`. */
  minimo?: string;
  maximo?: string;
  ayuda?: ReactNode;
  /** Mensaje de error ya redactado, que dice cómo corregirlo («La fecha “hasta” no puede ser anterior a “desde”»). */
  error?: ReactNode;
}

export function RangoDeFechas({ leyenda, desde, hasta, minimo, maximo, ayuda, error }: PropsDeRangoDeFechas) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{leyenda}</legend>
      {/* Una columna en celular y dos desde `sm:`: un solo componente, dos disposiciones. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoFecha etiqueta={desde.etiqueta ?? "Desde"} name={desde.name} defaultValue={desde.defaultValue} min={minimo} max={hasta.defaultValue || maximo} />
        <CampoFecha etiqueta={hasta.etiqueta ?? "Hasta"} name={hasta.name} defaultValue={hasta.defaultValue} min={desde.defaultValue || minimo} max={maximo} />
      </div>
      {ayuda ? <p className="text-xs text-neutral-600 dark:text-neutral-400">{ayuda}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
