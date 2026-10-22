import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";

/**
 * Los FILTROS de una lista de administración (Fase 6, bloque 3, 3b): un formulario GET que escribe la búsqueda y cada filtro como parámetro de la URL (`?q=pizza&tipo=venta`), así la lista se puede
 * compartir, volver atrás y recargar, y el filtrado lo hace el servidor (la pantalla solo dibuja y manda). Componente de SERVIDOR sin lógica de negocio: quien lo usa le pasa los filtros con sus opciones
 * ya redactadas y el valor que está vigente (ya validado contra su lista cerrada); no valida nada acá.
 *
 * La búsqueda lleva el nombre `q`; cada filtro, el suyo. «Filtrar» manda todo junto (también con Enter en la búsqueda) y «Limpiar filtros» vuelve a la lista sin parámetros. Cada control tiene su etiqueta
 * visible (`Campo`, `Selector`) y 44 px de alto en celular; en el celular se apilan y desde `sm:` se acomodan en dos columnas, desde `lg:` en cuatro.
 */
export interface FiltroDeLista {
  /** El nombre del parámetro de la URL. */
  nombre: string;
  etiqueta: string;
  /** El valor vigente (`""` = «todos»). */
  valor: string;
  opciones: readonly { valor: string; etiqueta: string }[];
}

interface PropsDeFiltrosDeLista {
  /** La ruta de la lista: el formulario la pide con GET y «Limpiar filtros» vuelve a ella. */
  accion: string;
  etiquetaDeLaBusqueda: string;
  marcadorDeLaBusqueda?: string;
  /** El término vigente de la búsqueda. */
  busqueda: string;
  filtros: readonly FiltroDeLista[];
  /** Hay algo puesto: muestra «Limpiar filtros». */
  hayFiltros: boolean;
}

export function FiltrosDeLista({ accion, etiquetaDeLaBusqueda, marcadorDeLaBusqueda, busqueda, filtros, hayFiltros }: PropsDeFiltrosDeLista) {
  return (
    <form method="get" action={accion} role="search" aria-label="Buscar y filtrar" className="mb-4 space-y-3">
      <div className="max-w-md">
        <Campo etiqueta={etiquetaDeLaBusqueda} type="text" name="q" defaultValue={busqueda} placeholder={marcadorDeLaBusqueda} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filtros.map((f) => (
          <Selector key={f.nombre} etiqueta={f.etiqueta} name={f.nombre} defaultValue={f.valor}>
            <option value="">Todos</option>
            {f.opciones.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </Selector>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <BotonDeServidor type="submit" tamano="tactil">
          Filtrar
        </BotonDeServidor>
        {hayFiltros && (
          <p className="text-sm">
            <Enlace href={accion}>Limpiar filtros</Enlace>
          </p>
        )}
      </div>
    </form>
  );
}
