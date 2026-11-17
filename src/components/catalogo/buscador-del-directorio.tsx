import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Enlace } from "@/ui/primitivas/enlace";
import { hayBusquedaDelDirectorio, type BusquedaDelDirectorio } from "@/core/catalogo/public";

/**
 * La barra de las listas de Proveedores y de Clientes con descuento, al estilo de Pedernal (`directorio.html`): «Buscar» y «Mostrar desactivados». Formulario GET que escribe todo en la dirección
 * (`?q=…&desactivados=1`): se comparte, se vuelve atrás y se recarga; el servidor lee y limita cada valor (`leerBusquedaDelDirectorio`). Componente de SERVIDOR, sin estado: la clave vuelve a armarlo con lo vigente.
 */
export function BuscadorDelDirectorio({ accion, busqueda, etiqueta, marcador }: { accion: string; busqueda: BusquedaDelDirectorio; etiqueta: string; marcador: string }) {
  return (
    <form key={JSON.stringify(busqueda)} method="get" action={accion} role="search" aria-label="Buscar" className="flex max-w-md flex-col gap-2">
      <Campo etiqueta={etiqueta} type="search" name="q" defaultValue={busqueda.q} placeholder={marcador} maxLength={100} />
      <Casilla etiqueta="Mostrar desactivados" name="desactivados" value="1" defaultChecked={busqueda.mostrarDesactivados} />
      <div className="flex flex-wrap items-center gap-3">
        <BotonDeServidor type="submit" tamano="tactil">
          Buscar
        </BotonDeServidor>
        {hayBusquedaDelDirectorio(busqueda) && (
          <p className="text-sm">
            <Enlace href={accion} variante="suelto">Limpiar</Enlace>
          </p>
        )}
      </div>
    </form>
  );
}
