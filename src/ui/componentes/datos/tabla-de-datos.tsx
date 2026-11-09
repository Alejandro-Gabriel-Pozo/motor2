import type { ReactNode } from "react";

/**
 * Tabla de datos adaptable del sistema de diseño (capa `ui/componentes`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * UN componente con DOS presentaciones que salen de las MISMAS definiciones de columnas (no son dos implementaciones sueltas):
 *  - desde `sm:` (≥640 px), tabla con columnas, sin scroll horizontal obligatorio;
 *  - en celular, según `presentacionCelular`: `tarjetas` (POR DEFECTO) es una lista de tarjetas (una columna hace de título y el resto se lee como pares «etiqueta: valor», sin scroll
 *    horizontal) y `tabla-con-scroll` es la misma tabla, que en celular se desplaza hacia el costado (para quien necesita ver todas las columnas juntas).
 * Se alternan con CSS (`hidden`/`sm:hidden`): lo oculto sale del árbol de accesibilidad, así que un lector de pantalla lee una sola presentación. Es un componente de servidor, sin
 * JavaScript, por eso no ordena ni pagina: eso es asunto de quien lo use (el orden ya viene en `filas`). `orden` solo MUESTRA por qué columna y en qué sentido vienen ordenadas
 * (`aria-sort` en el encabezado y una flecha): no ordena nada.
 *
 * ESTILO DE PLANILLA (docs/diseno-estilo-de-planilla-2026-11-09.md): la tabla va dentro de un contorno propio, con el encabezado en una banda de fondo suave y mayúsculas chicas, las filas separadas y
 * resaltadas al pasar el mouse, el relleno de las celdas parejo y los números a la derecha (`alinear: "derecha"`, con cifras de ancho fijo). Una columna con `accion: true` es la de las ACCIONES de la fila
 * (Editar, Activar…): tiene que ser la última; en la tabla es la columna final y en la tarjeta de celular es el pie de la tarjeta, con los toques de 44 px y siempre a la vista. Es solo presentación:
 * quién ve qué botón lo decide cada `celda` con el permiso que ya tenía, y el servidor vuelve a exigirlo.
 *
 * Reglas: el nombre accesible (`titulo`) es obligatorio, el estado vacío es obligatorio (una tabla que se queda en blanco no dice qué hacer), no hay dos columnas con el mismo `id` y
 * `orden` nombra una columna que existe. Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04).
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
  /** Columna de ACCIONES de la fila: la última; en la tarjeta de celular es el pie, sin etiqueta. */
  accion?: boolean;
}

export interface PropsDeTablaDeDatos<T> {
  /** Nombre de la tabla para el lector de pantalla y para el encabezado de la región («Compras registradas»). */
  titulo: string;
  columnas: readonly ColumnaDeTabla<T>[];
  filas: readonly T[];
  claveDeFila: (fila: T) => string;
  /** Qué ver si no hay filas, con el próximo paso («Todavía no hay compras. Registrá la primera desde Movimientos.»). */
  vacio: ReactNode;
  /** Cómo se ve en celular: `tarjetas` (por defecto) o `tabla-con-scroll`. Desde `sm:` es siempre la tabla. */
  presentacionCelular?: "tarjetas" | "tabla-con-scroll";
  /** Clases extra de la fila (el `<tr>` y su tarjeta), según el dato: una fila anulada, una resaltada. Devuelve `undefined` si no hay nada que agregar. */
  claseFila?: (fila: T) => string | undefined;
  /** Por qué columna (su `id`) y en qué sentido VIENEN ordenadas las filas: solo lo muestra, no ordena. */
  orden?: { columna: string; sentido: "ascendente" | "descendente" };
}

/** Línea de separación de la planilla: el borde de los controles al 60 %, la que se ve a simple vista entre celdas (el `borde` claro es solo decorativo). */
const BORDE = "border-borde-control/60";

const ARIA_SORT = { ascendente: "ascending", descendente: "descending" } as const;
const FLECHA = { ascendente: "▲", descendente: "▼" } as const;

const unirClases = (...clases: (string | undefined)[]) => clases.filter(Boolean).join(" ");

export function TablaDeDatos<T>({ titulo, columnas, filas, claveDeFila, vacio, presentacionCelular = "tarjetas", claseFila, orden }: PropsDeTablaDeDatos<T>) {
  const ids = columnas.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error(`TablaDeDatos «${titulo}»: hay columnas con el mismo id (${ids.join(", ")}).`);
  if (orden && !ids.includes(orden.columna)) throw new Error(`TablaDeDatos «${titulo}»: el orden nombra la columna «${orden.columna}», que no existe (${ids.join(", ")}).`);

  if (filas.length === 0) {
    return (
      <p role="status" className="text-sm text-tinta-suave">
        {vacio}
      </p>
    );
  }

  const columnaDeAccion = columnas.find((c) => c.accion);
  if (columnaDeAccion && columnas[columnas.length - 1] !== columnaDeAccion) throw new Error(`TablaDeDatos «${titulo}»: la columna de acciones «${columnaDeAccion.id}» tiene que ser la última.`);
  if (columnas.filter((c) => c.accion).length > 1) throw new Error(`TablaDeDatos «${titulo}»: solo puede haber una columna de acciones.`);

  const columnaTitulo = columnas.find((c) => c.titulo) ?? columnas.find((c) => !c.accion);
  const columnasDeTarjeta = columnas.filter((c) => c.id !== columnaTitulo?.id && !c.soloEnTabla && !c.accion);
  const conTarjetas = presentacionCelular === "tarjetas";

  return (
    <>
      {/* Celular: tarjetas (con `tabla-con-scroll` no se dibujan: la tabla es la única presentación). */}
      {conTarjetas ? (
        <ul aria-label={titulo} className="flex flex-col gap-2 sm:hidden">
          {filas.map((fila) => (
            // La tarjeta nunca se sale de su caja, por angosta que quede (un nombre largo, o el menú lateral abierto en el celular): las palabras se cortan donde haga falta
            // (`overflow-wrap: anywhere`) y la columna del valor puede achicarse por debajo de su palabra más larga (`minmax(0, 1fr)`).
            <li key={claveDeFila(fila)} className={unirClases("min-w-0 rounded border border-borde-control/60 p-3 [overflow-wrap:anywhere]", claseFila?.(fila))}>
              {columnaTitulo ? <p className="font-medium">{columnaTitulo.celda(fila)}</p> : null}
              <dl className="mt-2 text-sm">
                {columnasDeTarjeta.map((c) => (
                  // Cada par «etiqueta: valor» es una fila con su separador (la división entre celdas se nota también en la tarjeta); la etiqueta ocupa 2/5 y el valor 3/5, así los valores quedan alineados de tarjeta en tarjeta.
                  <div key={c.id} className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 border-t py-1.5 ${BORDE}`}>
                    <dt className="text-tinta-suave">{c.encabezado}</dt>
                    <dd className={c.alinear === "derecha" ? "text-right" : undefined}>{c.celda(fila)}</dd>
                  </div>
                ))}
              </dl>
              {columnaDeAccion ? (
                // Pie de la tarjeta: las acciones a la vista, cada control con el toque de 44 px (los enlaces y botones de la celda se estiran a esa altura).
                <div data-acciones-de-fila="" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-borde-control/60 pt-2 text-sm [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
                  {columnaDeAccion.celda(fila)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Desde sm: tabla (en celular, solo con `tabla-con-scroll`, que se desplaza hacia el costado). La región recibe foco para poder desplazarla con el teclado si el contenido igual no entra. */}
      <div role="region" aria-label={titulo} tabIndex={0} className={`rounded border border-borde-control/60 bg-superficie ${conTarjetas ? "hidden overflow-x-auto sm:block" : "overflow-x-auto"}`}>
        <table className={conTarjetas ? "w-full text-sm" : "w-full text-sm max-sm:min-w-max"}>
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr className="border-b border-borde-control/60 bg-superficie-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
              {columnas.map((c) => (
                <th key={c.id} scope="col" aria-sort={orden?.columna === c.id ? ARIA_SORT[orden.sentido] : undefined} className={unirClases("border-l border-borde-control/60 px-3 py-2 font-semibold first:border-l-0", c.alinear === "derecha" ? "text-right" : undefined, c.accion ? "whitespace-nowrap" : undefined)}>
                  {c.encabezado}
                  {orden?.columna === c.id ? <span aria-hidden="true"> {FLECHA[orden.sentido]}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={claveDeFila(fila)} className={unirClases("border-b border-borde-control/60 last:border-b-0 hover:bg-papel", claseFila?.(fila))}>
                {columnas.map((c) => (
                  <td key={c.id} className={unirClases("border-l border-borde-control/60 px-3 py-2.5 align-middle first:border-l-0", c.alinear === "derecha" ? "text-right tabular-nums" : undefined, c.accion ? "whitespace-nowrap" : undefined)}>
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
