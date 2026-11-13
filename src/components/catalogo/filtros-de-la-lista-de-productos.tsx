import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";
import { PestanasDeRuta } from "@/ui/componentes/navegacion/pestanas-de-ruta";
import type { FiltrosDeProductos, TipoFiltrable } from "@/core/catalogo/public";
import { consultaDeLosFiltros } from "@/core/catalogo/public";

/**
 * La barra de la lista de Productos, como la de Pedernal («Productos y precios»): el buscador y un chip por cada «¿Qué es?» (Todos, y uno por clase). Lo demás que ya se podía filtrar (cómo se vende,
 * disponibilidad, qué le falta) sigue estando, detrás de «Más filtros» (no se quita ningún filtro: docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1). Componente de SERVIDOR sin lógica de negocio: un
 * formulario GET que escribe todo en la URL (`?q=…&tipo=…`) (el mismo mecanismo que tuvo la lista de filtros compartida de las listas de administración), así se comparte, se vuelve atrás y se recarga; el servidor valida cada valor contra su lista cerrada.
 *
 * Los chips son enlaces (pestañas de ruta): uno por clase de `clases`, en ese orden, más «Todos». Cada chip conserva el resto de los filtros puestos y la búsqueda, y se marca el vigente.
 */
export interface FiltroDeMasFiltros {
  nombre: string;
  etiqueta: string;
  valor: string;
  opciones: readonly { valor: string; etiqueta: string }[];
}

interface Props {
  accion: string;
  filtros: FiltrosDeProductos;
  clases: readonly { valor: TipoFiltrable; etiqueta: string }[];
  masFiltros: readonly FiltroDeMasFiltros[];
  hayFiltros: boolean;
  etiquetaDeLaBusqueda: string;
  marcadorDeLaBusqueda: string;
}

function hrefDelChip(accion: string, filtros: FiltrosDeProductos, tipo: TipoFiltrable | null): string {
  const consulta = consultaDeLosFiltros({ ...filtros, tipo });
  return consulta === "" ? accion : `${accion}?${consulta}`;
}

export function FiltrosDeLaListaDeProductos({ accion, filtros, clases, masFiltros, hayFiltros, etiquetaDeLaBusqueda, marcadorDeLaBusqueda }: Props) {
  // Los controles son NO controlados (`defaultValue`): la clave, que cambia con lo vigente, vuelve a armar el formulario con lo que dice la URL (atrás/adelante, «Limpiar»).
  const clave = JSON.stringify([filtros.q, filtros.tipo, ...masFiltros.map((f) => f.valor)]);
  const hayMasFiltros = masFiltros.some((f) => f.valor !== "");
  return (
    <div className="flex flex-col gap-3">
      <form key={clave} method="get" action={accion} role="search" aria-label="Buscar y filtrar" className="flex flex-col gap-3">
        {filtros.tipo && <input type="hidden" name="tipo" value={filtros.tipo} />}
        <Campo etiqueta={etiquetaDeLaBusqueda} type="text" name="q" defaultValue={filtros.q} placeholder={marcadorDeLaBusqueda} />
        <details open={hayMasFiltros} className="text-sm">
          <summary className="cursor-pointer text-tinta-suave underline">Más filtros</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {masFiltros.map((f) => (
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
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <BotonDeServidor type="submit" tamano="tactil">
            Buscar
          </BotonDeServidor>
          {hayFiltros && (
            <p className="text-sm">
              <Enlace href={accion}>Limpiar filtros</Enlace>
            </p>
          )}
        </div>
      </form>
      <PestanasDeRuta
        etiqueta="¿Qué es?"
        disposicion="envuelta"
        pestanas={[{ href: hrefDelChip(accion, filtros, null), texto: "Todos", actual: filtros.tipo === null }, ...clases.map((c) => ({ href: hrefDelChip(accion, filtros, c.valor), texto: c.etiqueta, actual: filtros.tipo === c.valor }))]}
      />
    </div>
  );
}
