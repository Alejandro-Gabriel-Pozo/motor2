import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";
import type { FiltrosDeProductos } from "@/core/catalogo/public";

/**
 * La barra de la lista de Productos, igual a la de Pedernal (`FormularioDeFiltrosDeProductos`, maqueta `productos.html`): «Buscar», el selector «¿Qué es?», el selector «Estado» y «Aplicar filtros». Lo demás que ya se
 * podía filtrar (cómo se vende, qué le falta) sigue estando, detrás de «Más filtros» (no se quita ningún filtro: docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1). Componente de SERVIDOR sin lógica de negocio: un
 * formulario GET que escribe todo en la URL (`?q=…&tipo=…`), así se comparte, se vuelve atrás y se recarga; el servidor valida cada valor contra su lista cerrada.
 */
export interface OpcionDeFiltro {
  valor: string;
  etiqueta: string;
}

export interface FiltroDeMasFiltros {
  nombre: string;
  etiqueta: string;
  valor: string;
  opciones: readonly OpcionDeFiltro[];
}

interface Props {
  accion: string;
  filtros: FiltrosDeProductos;
  clases: readonly OpcionDeFiltro[];
  estados: readonly OpcionDeFiltro[];
  masFiltros: readonly FiltroDeMasFiltros[];
  hayFiltros: boolean;
  etiquetaDeLaBusqueda: string;
  marcadorDeLaBusqueda: string;
}

function Opciones({ opciones }: { opciones: readonly OpcionDeFiltro[] }) {
  return (
    <>
      <option value="">Todos</option>
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ))}
    </>
  );
}

export function FiltrosDeLaListaDeProductos({ accion, filtros, clases, estados, masFiltros, hayFiltros, etiquetaDeLaBusqueda, marcadorDeLaBusqueda }: Props) {
  // Los controles son NO controlados (`defaultValue`): la clave, que cambia con lo vigente, vuelve a armar el formulario con lo que dice la URL (atrás/adelante, «Limpiar»).
  const clave = JSON.stringify([filtros.q, filtros.tipo, filtros.disponible, ...masFiltros.map((f) => f.valor)]);
  const hayMasFiltros = masFiltros.some((f) => f.valor !== "");
  return (
    <form key={clave} method="get" action={accion} role="search" aria-label="Buscar y filtrar" className="flex flex-col gap-3">
      <Campo etiqueta={etiquetaDeLaBusqueda} type="text" name="q" defaultValue={filtros.q} placeholder={marcadorDeLaBusqueda} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Selector etiqueta="¿Qué es?" name="tipo" defaultValue={filtros.tipo ?? ""}>
          <Opciones opciones={clases} />
        </Selector>
        <Selector etiqueta="Estado" name="disponible" defaultValue={filtros.disponible ?? ""}>
          <Opciones opciones={estados} />
        </Selector>
      </div>
      <details open={hayMasFiltros} className="text-sm">
        <summary className="cursor-pointer text-tinta-suave underline">Más filtros</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {masFiltros.map((f) => (
            <Selector key={f.nombre} etiqueta={f.etiqueta} name={f.nombre} defaultValue={f.valor}>
              <Opciones opciones={f.opciones} />
            </Selector>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <BotonDeServidor type="submit" tamano="tactil">
          Aplicar filtros
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
