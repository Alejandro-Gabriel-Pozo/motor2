import { IconoDeAccion } from "@/components/iconos";
import { FilaDeStock } from "@/components/fila-de-stock";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
import { FormConResultado } from "@/components/form-con-resultado";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ResultadoAccion } from "@/server/actions/tipos";

/**
 * Dibujo común de los dos catálogos simples de Configuración de Stock (Motivos de merma y Destinos de consumo): una tabla
 * Nombre / Activo / acción y, para quien puede editar, un formulario de alta. Solo DIBUJA: cada página conserva su lectura, su gate de
 * permiso (`requierePermisoVerDeEmpresa`) y sus acciones, y se las pasa por props. Las acciones llegan como Server Actions ya
 * existentes (`activar` se ata con `bind`); `crear` es el `action` del formulario de alta, definido en la página.
 */
export type ItemDeMaestroSimple = { id: string; nombre: string; descripcion: string | null; activo: boolean };

export function PanelDeMaestroSimple({
  ctx,
  titulo,
  ruta,
  quePuedeVer,
  items,
  puedeEditar,
  activar,
  crear,
  etiquetaNombre,
  placeholderNombre,
}: {
  ctx: ContextoUsuario;
  titulo: string;
  ruta: string;
  /** Texto del aviso de solo lectura: «Solo lectura: tu rol puede ver {quePuedeVer}, …». */
  quePuedeVer: string;
  items: ItemDeMaestroSimple[];
  puedeEditar: boolean;
  activar: (id: string, activo: boolean) => Promise<ResultadoAccion>;
  crear: (formData: FormData) => Promise<ResultadoAccion>;
  etiquetaNombre: string;
  placeholderNombre: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{titulo}</h1>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta={ruta} />
      {!puedeEditar && <AvisoSoloLecturaDeStock que={quePuedeVer} />}

      <section className="space-y-4">
        <div role="group" aria-label="Datos del maestro" tabIndex={0} className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Nombre</th>
              <th>Activo</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-b align-top">
                <td className="py-2">
                  <div>{m.nombre}</div>
                  {m.descripcion && <div className="text-xs text-tinta-tenue">{m.descripcion}</div>}
                </td>
                <td>{m.activo ? "Sí" : "No"}</td>
                <td>
                  {puedeEditar && (
                    <FormConResultado accion={activar.bind(null, m.id, !m.activo)}>
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {m.activo ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>

        {puedeEditar && (
          <FormConResultado accion={crear} className="max-w-md space-y-1">
            <div className="flex gap-2">
              <div className="flex-1">
                <Campo name="nombre" aria-label={etiquetaNombre} placeholder={placeholderNombre} required />
              </div>
              <BotonDeServidor type="submit">Crear</BotonDeServidor>
            </div>
            <Campo name="descripcion" aria-label="Descripción (opcional)" placeholder="descripción (opcional)" />
          </FormConResultado>
        )}
      </section>
    </div>
  );
}
