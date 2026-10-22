"use client";

import { useState } from "react";
import { FormConResultado } from "@/components/form-con-resultado";
import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";
import { CamposDeVersion, type ReferenciaDePrecio } from "./campos-de-version";
import type { InsumoParaConsumo } from "./editor-de-consumos";
import type { RecetaDeReferencia } from "./lectura-del-factor";

/**
 * El alta de una opción en un grupo (GO-2d): el nombre, si es la opción «ninguna» (solo en una variante o en lo incluido, y una por grupo: «sin guarnición», «sin leche») y su
 * precio (`CamposDeVersion`). En un ADICIONAL se elige además la unidad del producto interno que respalda su stock: lo crea el sistema y no hay que administrarlo. El servidor
 * vuelve a validar todo; su mensaje se ve al pie.
 */
export function AltaDeOpcion({
  tipo,
  admiteNinguna,
  referencia,
  receta,
  unidades,
  insumos,
  accion,
}: {
  tipo: TipoDeGrupoDeOpciones;
  /** Si todavía se puede agregar la «ninguna» (el tipo la admite y el grupo no tiene una). */
  admiteNinguna: boolean;
  referencia: ReferenciaDePrecio | null;
  /** OPCIONES-FACTOR: la receta de referencia para leer el factor de un tamaño (`null`: solo la frase). */
  receta: RecetaDeReferencia | null;
  unidades: { id: string; nombre: string }[];
  /** Las materias primas para los consumos; `null` = la empresa no tiene el módulo Recetas (se guarda sin consumos). */
  insumos: InsumoParaConsumo[] | null;
  accion: (formData: FormData) => Promise<ResultadoAccion>;
}) {
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
      <Campo etiqueta="Nombre de la opción" name="nombre" required maxLength={120} placeholder={tipo === "MEDIDA" ? "Ej.: Mediano" : tipo === "ADICIONAL" ? "Ej.: Huevo frito" : "Ej.: Con leche"} />
      {admiteNinguna && <Casilla etiqueta="Es la opción «ninguna» (por ejemplo, «Sin guarnición»): no lleva precio ni consumo" name="esNinguna" checked={esNinguna} onChange={(e) => setEsNinguna(e.target.checked)} />}
      <CamposDeVersion key={formulario} tipo={tipo} sinPrecio={esNinguna} referencia={referencia} receta={receta} consumos={insumos ? { insumos, inicial: [] } : null} />
      {tipo === "ADICIONAL" && (
        <div className="flex flex-col gap-1">
          <Selector etiqueta="Unidad para el stock del adicional" name="unidadAncla" required defaultValue="" className="max-w-xs">
            <option value="" disabled>
              Elegí la unidad
            </option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </Selector>
          <p className="text-xs text-tinta-suave">El sistema crea un producto interno para el stock de este adicional; no lo tenés que administrar.</p>
        </div>
      )}
      <Boton type="submit" className="self-start">
        Agregar opción
      </Boton>
    </FormConResultado>
  );
}
