"use client";

import { useId, useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { CamposDeVersion, type ReferenciaDePrecio } from "./campos-de-version";
import type { InsumoParaConsumo } from "./editor-de-consumos";

/**
 * El alta de una opción en un grupo (GO-2d): el nombre, si es la opción «ninguna» (solo en una variante o en lo incluido, y una por grupo: «sin guarnición», «sin leche») y su
 * precio (`CamposDeVersion`). En un ADICIONAL se elige además la unidad del producto interno que respalda su stock: lo crea el sistema y no hay que administrarlo. El servidor
 * vuelve a validar todo; su mensaje se ve al pie.
 */
export function AltaDeOpcion({
  tipo,
  admiteNinguna,
  referencia,
  unidades,
  insumos,
  accion,
}: {
  tipo: TipoDeGrupoDeOpciones;
  /** Si todavía se puede agregar la «ninguna» (el tipo la admite y el grupo no tiene una). */
  admiteNinguna: boolean;
  referencia: ReferenciaDePrecio | null;
  unidades: { id: string; nombre: string }[];
  /** Las materias primas para los consumos; `null` = la empresa no tiene el módulo Recetas (se guarda sin consumos). */
  insumos: InsumoParaConsumo[] | null;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
}) {
  const id = useId();
  const [esNinguna, setEsNinguna] = useState(false);
  const [formulario, setFormulario] = useState(0);

  return (
    <FormConResultado
      accion={async (fd) => {
        const r = await accion(fd);
        // Un alta que salió bien deja el formulario en blanco (los campos de precio son controlados: se rearman).
        if (r.ok) {
          setEsNinguna(false);
          setFormulario((n) => n + 1);
        }
        return r;
      }}
      className="flex max-w-xl flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-nombre`} className="text-sm font-medium">
          Nombre de la opción
        </label>
        <input id={`${id}-nombre`} name="nombre" required maxLength={120} placeholder={tipo === "MEDIDA" ? "Ej.: Mediano" : tipo === "ADICIONAL" ? "Ej.: Huevo frito" : "Ej.: Con leche"} className="rounded border px-3 py-2" />
      </div>
      {admiteNinguna && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" name="esNinguna" checked={esNinguna} onChange={(e) => setEsNinguna(e.target.checked)} />
          Es la opción «ninguna» (por ejemplo, «Sin guarnición»): no lleva precio ni consumo
        </label>
      )}
      <CamposDeVersion key={formulario} tipo={tipo} sinPrecio={esNinguna} referencia={referencia} consumos={insumos ? { insumos, inicial: [] } : null} />
      {tipo === "ADICIONAL" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-unidad`} className="text-sm font-medium">
            Unidad para el stock del adicional
          </label>
          <select id={`${id}-unidad`} name="unidadAncla" required defaultValue="" className="max-w-xs rounded border px-3 py-2">
            <option value="" disabled>
              Elegí la unidad
            </option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">El sistema crea un producto interno para el stock de este adicional; no lo tenés que administrar.</p>
        </div>
      )}
      <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-white">
        Agregar opción
      </button>
    </FormConResultado>
  );
}
