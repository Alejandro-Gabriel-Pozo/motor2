"use client";

import { useRef, type ChangeEvent } from "react";
import { ordenSugeridoAlElegirSeccion } from "@/core/carta/public";

const CLASE_INPUT = "rounded border px-2 py-1";

/**
 * El select de sección de carta + el orden dentro de esa sección, de un producto suelto (/carta) o de un ítem agrupado
 * (/carta/agrupados) — docs/plan-carta-seccion-directa-2026-09-25.md, DA6/M8. Al elegir (o cambiar) de sección, el orden se
 * autocompleta con el sugerido para esa sección (`ordenSugeridoAlElegirSeccion`: la cantidad de ítems que ya tiene, o el guardado si
 * se vuelve a la sección que ya tenía); sigue siendo editable a mano.
 *
 * Campos NO controlados (mismo criterio que `EditorTema`): van dentro de un `FormConResultado`, que hace `form.reset()` cuando la
 * acción sale bien. Así el reset vuelve a los `defaultValue` (lo guardado) sin estado de React que sincronizar; el sugerido solo
 * escribe el valor del input al cambiar el select.
 */
export function SeccionYOrden({
  secciones,
  cantidadPorSeccion,
  guardado,
  etiquetaSeccion,
  requerida = false,
  conOpcionVacia = true,
}: {
  secciones: readonly { id: string; nombre: string; activa: boolean }[];
  /** seccionCartaId → cuántos ítems ya están ubicados ahí (lo precalcula el servidor). */
  cantidadPorSeccion: Readonly<Record<string, number>>;
  /** Lo guardado, si ya existe (editar); null = alta. */
  guardado: { seccionCartaId: string | null; orden: number } | null;
  etiquetaSeccion: string;
  requerida?: boolean;
  /** Mostrar "— elegí una —" (alta, o un contenido que puede quedar sin sección). */
  conOpcionVacia?: boolean;
}) {
  const orden = useRef<HTMLInputElement>(null);

  const alCambiarSeccion = (e: ChangeEvent<HTMLSelectElement>) => {
    const sugerido = ordenSugeridoAlElegirSeccion(e.currentTarget.value, guardado, cantidadPorSeccion);
    if (sugerido !== null && orden.current) orden.current.value = String(sugerido);
  };

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        {etiquetaSeccion}
        <select name="seccionCartaId" required={requerida} defaultValue={guardado?.seccionCartaId ?? ""} onChange={alCambiarSeccion} className={CLASE_INPUT}>
          {conOpcionVacia && <option value="">— elegí una —</option>}
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden dentro de su sección
        <input ref={orden} name="orden" type="number" step={1} defaultValue={guardado?.orden ?? 0} className={CLASE_INPUT} />
      </label>
    </>
  );
}
