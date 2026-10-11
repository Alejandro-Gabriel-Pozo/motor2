import type { ReactNode } from "react";

/**
 * Tabla de datos adaptable del sistema de diseño (capa `ui/componentes`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * UN componente con DOS presentaciones que salen de las MISMAS definiciones de columnas (no son dos implementaciones sueltas):
 *  - desde `sm:` (≥640 px), tabla con columnas, sin scroll horizontal obligatorio;
 *  - en celular, lista de tarjetas: una columna hace de título y el resto se lee como pares «etiqueta: valor». Sin scroll horizontal.
 * Se alternan con CSS (`hidden`/`sm:hidden`): lo oculto sale del árbol de accesibilidad, así que un lector de pantalla lee una sola presentación. Es un componente de servidor, sin
 * JavaScript, por eso no ordena ni pagina: eso es asunto de quien lo use (el orden ya viene en `filas`).
 *
 * Reglas: el nombre accesible (`titulo`) es obligatorio, el estado vacío es obligatorio (una tabla que se queda en blanco no dice qué hacer) y no hay dos columnas con el mismo `id`.
 */
export interface ColumnaDeTabla<T> {
  /** Identificador estable de la columna (clave de React y de la tarjeta). */
  id: string;
  /** Texto del encabezado y de la etiqueta en la tarjeta. */
  encabezado: string;
  celda: (fila: T) => ReactNode;
  alinear?: "izquierda" | "derecha";
  /** En la tarjeta de celular esta columna es el título (solo una; si ninguna lo declara, la primera). */
  titulo?: boolean;
  /** La columna se muestra en la tabla pero no en la tarjeta (información secundaria). */
  soloEnTabla?: boolean;
}

export interface PropsDeTablaDeDatos<T> {
  /** Nombre de la tabla para el lector de pantalla y para el encabezado de la región («Compras registradas»). */
  titulo: string;
  columnas: readonly ColumnaDeTabla<T>[];
  filas: readonly T[];
  claveDeFila: (fila: T) => string;
  /** Qué ver si no hay filas, con el próximo paso («Todavía no hay compras. Registrá la primera desde Movimientos.»). */
  vacio: ReactNode;
}

export function TablaDeDatos<T>({ titulo, columnas, filas, claveDeFila, vacio }: PropsDeTablaDeDatos<T>) {
  const ids = columnas.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error(`TablaDeDatos «${titulo}»: hay columnas con el mismo id (${ids.join(", ")}).`);

  if (filas.length === 0) {
    return (
      <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
        {vacio}
      </p>
    );
  }

  const columnaTitulo = columnas.find((c) => c.titulo) ?? columnas[0];
  const columnasDeTarjeta = columnas.filter((c) => c.id !== columnaTitulo?.id && !c.soloEnTabla);

  return (
    <>
      {/* Celular: tarjetas. */}
      <ul aria-label={titulo} className="flex flex-col gap-2 sm:hidden">
        {filas.map((fila) => (
          <li key={claveDeFila(fila)} className="rounded border border-neutral-300 p-3 dark:border-neutral-700">
            {columnaTitulo ? <p className="font-medium">{columnaTitulo.celda(fila)}</p> : null}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {columnasDeTarjeta.map((c) => (
                <div key={c.id} className="contents">
                  <dt className="text-neutral-600 dark:text-neutral-400">{c.encabezado}</dt>
                  <dd className={c.alinear === "derecha" ? "text-right" : undefined}>{c.celda(fila)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* Desde sm: tabla. La región recibe foco para poder desplazarla con el teclado si el contenido igual no entra. */}
      <div role="region" aria-label={titulo} tabIndex={0} className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr className="border-b text-left text-neutral-600 dark:text-neutral-400">
              {columnas.map((c) => (
                <th key={c.id} scope="col" className={`py-2 pr-3 font-medium ${c.alinear === "derecha" ? "text-right" : ""}`}>
                  {c.encabezado}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={claveDeFila(fila)} className="border-b">
                {columnas.map((c) => (
                  <td key={c.id} className={`py-2 pr-3 ${c.alinear === "derecha" ? "text-right" : ""}`}>
                    {c.celda(fila)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
