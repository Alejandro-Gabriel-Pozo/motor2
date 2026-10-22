"use client";

import { useId, useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import { ayudaDelTipoDeGrupo, nombreDelTipoDeGrupo, TIPOS_DE_GRUPO_DE_OPCIONES, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";

/**
 * El alta de un grupo de opciones de venta (GO-2d): nombre, tipo y cuántas se eligen. El tipo no se puede cambiar después (la pantalla lo avisa), así que se elige con radios
 * que muestran la ayuda de cada uno. Un TAMAÑO se elige siempre una vez (1 y 1: los campos quedan fijos) y una opción INCLUIDA es obligatoria (mínimo 1 o más). Es solo
 * ayuda: el servidor vuelve a validar todo (`validarGrupo`) y su mensaje se ve al pie.
 */
export function AltaDeGrupo({ accion }: { accion: (formData: FormData) => Promise<ResultadoAccion> }) {
  const id = useId();
  const [tipo, setTipo] = useState<TipoDeGrupoDeOpciones>("VARIANTE");
  const [minimo, setMinimo] = useState("1");
  const [maximo, setMaximo] = useState("1");
  const fijo = tipo === "MEDIDA";

  const elegirTipo = (t: TipoDeGrupoDeOpciones) => {
    setTipo(t);
    if (t === "MEDIDA") {
      setMinimo("1");
      setMaximo("1");
    } else if (t === "ADICIONAL") {
      setMinimo("0");
      setMaximo("2");
    } else {
      setMinimo("1");
      setMaximo("1");
    }
  };

  return (
    <FormConResultado accion={accion} className="flex max-w-xl flex-col gap-3">
      <Campo etiqueta="Nombre del grupo" name="nombre" required maxLength={120} placeholder="Ej.: Tamaño del café, Guarnición" />
      <OpcionesExcluyentes
        leyenda="Tipo (no se puede cambiar después)"
        nombre="tipo"
        valorInicial={tipo}
        alCambiar={(valor) => elegirTipo(valor as TipoDeGrupoDeOpciones)}
        presentacion="tarjetas"
        opciones={TIPOS_DE_GRUPO_DE_OPCIONES.map((t) => ({ valor: t, etiqueta: nombreDelTipoDeGrupo(t), ayuda: ayudaDelTipoDeGrupo(t) }))}
      />
      <div role="group" aria-label="Cuántas se eligen" aria-describedby={`${id}-ayuda-cantidades`} className="flex flex-wrap gap-4">
        <Campo
          etiqueta="Mínimo a elegir"
          name="cantidadMinima"
          inputMode="numeric"
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
          readOnly={fijo}
          className="max-w-24"
        />
        <Campo
          etiqueta="Máximo a elegir"
          name="cantidadMaxima"
          inputMode="numeric"
          value={maximo}
          onChange={(e) => setMaximo(e.target.value)}
          readOnly={fijo}
          className="max-w-24"
        />
      </div>
      <p id={`${id}-ayuda-cantidades`} className="text-xs text-tinta-suave">
        {fijo
          ? "Un tamaño se elige siempre una vez: mínimo 1 y máximo 1."
          : tipo === "INCLUIDA"
            ? "Lo incluido es obligatorio: el mínimo es 1 o más."
            : "Con mínimo 0 el grupo es opcional."}
      </p>
      <Boton type="submit" className="self-start">
        Crear grupo
      </Boton>
    </FormConResultado>
  );
}
