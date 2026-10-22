"use client";

import { useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import type { DiferenciaDePrecio, TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { CamposDeVersion, type ReferenciaDePrecio } from "./campos-de-version";
import type { ConsumoEnEdicion, InsumoParaConsumo } from "./editor-de-consumos";
import type { RecetaDeReferencia } from "./lectura-del-factor";

/**
 * «Cambiar precio o consumo» de una opción (GO-2d): lo que cobra y lo que consume una opción no se edita en el lugar, se le carga un CAMBIO que rige desde que se guarda (el
 * historial queda; lo vendido antes conserva lo que tenía). El formulario arranca con lo que rige hoy. El cambio lleva el número del que rige y que la pantalla mostraba: si otra
 * persona cargó uno en el medio, el servidor lo rechaza y aparece «Recargar».
 */
export function CambiarPrecio({
  nombre,
  tipo,
  esNinguna,
  referencia,
  receta,
  rige,
  insumos,
  accion,
}: {
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  esNinguna: boolean;
  referencia: ReferenciaDePrecio | null;
  /** OPCIONES-FACTOR: la receta de referencia para leer el factor de un tamaño (`null`: solo la frase). */
  receta: RecetaDeReferencia | null;
  rige: { diferencia: DiferenciaDePrecio; factorEscala: number | null; consumos: ConsumoEnEdicion[] };
  insumos: InsumoParaConsumo[] | null;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <Boton variante="enlace" tamano="tactil" onClick={() => setAbierto(true)} aria-label={`Cambiar precio o consumo de ${nombre}`} className="self-start">
        Cambiar precio o consumo
      </Boton>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <p className="text-sm font-medium">Cambio de precio o de consumo de «{nombre}» (rige desde que lo guardás)</p>
      <FormConResultado ofrecerRecargar accion={accion} className="flex flex-col gap-3">
        <CamposDeVersion tipo={tipo} sinPrecio={esNinguna} referencia={referencia} receta={receta} inicial={rige} consumos={insumos ? { insumos, inicial: rige.consumos } : null} />
        <Boton type="submit" className="self-start">
          Guardar el cambio
        </Boton>
      </FormConResultado>
      <Boton variante="enlace" tamano="chico" onClick={() => setAbierto(false)} className="self-start">
        Cerrar
      </Boton>
    </div>
  );
}
