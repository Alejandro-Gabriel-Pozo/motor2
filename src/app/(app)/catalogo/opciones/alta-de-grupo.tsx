"use client";

import { useId, useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import { ayudaDelTipoDeGrupo, nombreDelTipoDeGrupo, TIPOS_DE_GRUPO_DE_OPCIONES, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";

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
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-nombre`} className="text-sm font-medium">
          Nombre del grupo
        </label>
        <input id={`${id}-nombre`} name="nombre" required maxLength={120} placeholder="Ej.: Tamaño del café, Guarnición" className="rounded border px-3 py-2" />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Tipo (no se puede cambiar después)</legend>
        {TIPOS_DE_GRUPO_DE_OPCIONES.map((t) => (
          <label key={t} className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded border px-3 py-2 has-[:checked]:border-neutral-900 dark:has-[:checked]:border-neutral-100">
            <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => elegirTipo(t)} className="mt-1" />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{nombreDelTipoDeGrupo(t)}</span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400">{ayudaDelTipoDeGrupo(t)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-minimo`} className="text-sm font-medium">
            Mínimo a elegir
          </label>
          <input
            id={`${id}-minimo`}
            name="cantidadMinima"
            inputMode="numeric"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            readOnly={fijo}
            aria-describedby={`${id}-ayuda-cantidades`}
            className="w-24 rounded border px-3 py-2 read-only:bg-neutral-100 dark:read-only:bg-neutral-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-maximo`} className="text-sm font-medium">
            Máximo a elegir
          </label>
          <input
            id={`${id}-maximo`}
            name="cantidadMaxima"
            inputMode="numeric"
            value={maximo}
            onChange={(e) => setMaximo(e.target.value)}
            readOnly={fijo}
            aria-describedby={`${id}-ayuda-cantidades`}
            className="w-24 rounded border px-3 py-2 read-only:bg-neutral-100 dark:read-only:bg-neutral-800"
          />
        </div>
      </div>
      <p id={`${id}-ayuda-cantidades`} className="text-xs text-neutral-600 dark:text-neutral-400">
        {fijo
          ? "Un tamaño se elige siempre una vez: mínimo 1 y máximo 1."
          : tipo === "INCLUIDA"
            ? "Lo incluido es obligatorio: el mínimo es 1 o más."
            : "Con mínimo 0 el grupo es opcional."}
      </p>
      <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-white">
        Crear grupo
      </button>
    </FormConResultado>
  );
}
