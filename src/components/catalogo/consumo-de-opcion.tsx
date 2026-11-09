"use client";

import { useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import type { EstadoDelConsumo, TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Insignia } from "@/ui/primitivas/insignia";
import { EditorDeConsumos, type ConsumoEnEdicion, type InsumoParaConsumo } from "./editor-de-consumos";

/**
 * Lo que consume UNA opción, en la pestaña Opciones de un producto (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`): su consumo vigente en lenguaje llano y, si la persona puede, «Editar consumo», que abre
 * el MISMO editor (`EditorDeConsumos`) que la Biblioteca de opciones y llama a la misma acción del servidor (`agregarVersionDeOpcion`, que arma la página): cada guardado agrega una versión nueva de la opción (inmutable), con
 * el número vigente que esta pantalla leyó como esperado; si otra persona guardó antes, el servidor lo rechaza y aparece «Recargar». Lo que se muestra y si se ofrece editar lo decidieron las reglas puras
 * (`reglaDeConsumoDeOpcion`): esta pieza solo dibuja. Lo que falta se dice «pendiente de completar»; nunca se inventa un consumo.
 *
 * La página la monta con `key` = opción + número vigente: al guardarse una versión nueva el editor vuelve a empezar, cerrado y con lo que rige.
 */
export function ConsumoDeOpcion({
  nombre,
  tipo,
  estado,
  frases,
  factor,
  motivoSinEdicion,
  edicion,
}: {
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  estado: EstadoDelConsumo;
  /** Una frase por línea de consumo (vacío si no hay). */
  frases: string[];
  /** El factor del tamaño en solo lectura (`null` si no aplica). */
  factor: string | null;
  /** Por qué no se ofrece editar (`null` si se ofrece o si no hace falta explicarlo). */
  motivoSinEdicion: string | null;
  /** Presente solo si se ofrece editar: lo que rige hoy, los insumos y la acción de guardar. */
  edicion: { insumos: InsumoParaConsumo[]; inicial: ConsumoEnEdicion[]; accion: (formData: FormData) => Promise<ResultadoAccion> } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <li data-consumo-de-opcion={nombre} data-consumo-estado={estado} className="flex flex-col gap-1.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">{nombre}</span>
        {estado === "PENDIENTE" && <Insignia tono="aviso">pendiente de completar</Insignia>}
        {estado === "NO_CONSUME" && <Insignia>ninguna</Insignia>}
      </div>
      {estado === "NO_CONSUME" && <p className="text-sm text-tinta-suave">No consume.</p>}
      {estado === "PENDIENTE" && <p className="text-sm text-tinta-suave">Consumo: pendiente de completar.</p>}
      {estado === "CARGADO" && (
        <ul aria-label={`Qué consume ${nombre}`} className="flex flex-col gap-0.5 text-sm text-tinta-suave">
          {frases.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {factor && <p className="text-sm text-tinta-suave">{factor}</p>}
      {motivoSinEdicion && <p className="text-xs text-tinta-suave">{motivoSinEdicion}</p>}
      {edicion &&
        (abierto ? (
          <div className="flex flex-col gap-2 rounded border border-borde p-3">
            <p className="text-sm font-medium">Qué consume «{nombre}» (rige desde que lo guardás)</p>
            <FormConResultado ofrecerRecargar accion={edicion.accion} className="flex flex-col gap-3">
              <EditorDeConsumos tipo={tipo} insumos={edicion.insumos} inicial={edicion.inicial} />
              <Boton type="submit" className="self-start">
                Guardar el consumo
              </Boton>
            </FormConResultado>
            <Boton variante="enlace" tamano="chico" onClick={() => setAbierto(false)} className="self-start">
              Cerrar
            </Boton>
          </div>
        ) : (
          <Boton variante="enlace" tamano="tactil" onClick={() => setAbierto(true)} aria-label={`Editar consumo de ${nombre}`} className="self-start">
            Editar consumo
          </Boton>
        ))}
    </li>
  );
}
