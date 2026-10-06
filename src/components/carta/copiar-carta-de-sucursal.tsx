"use client";

import { useId, useState } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { copiarCartaDeSucursal } from "@/server/actions/carta/copiar-carta";

export interface OrigenCopiable {
  id: string;
  nombre: string;
  cantidadProductos: number;
}

/**
 * «Copiar de otra sucursal» (ADR-009, C3/C4): solo se dibuja sobre una carta VACÍA. Elegís la sucursal de origen y confirmás en el mismo lugar
 * (`BotonConConfirmacion`: foco, Escape, role="alert"/"status"). La acción vuelve a comprobar todo en el servidor; esto es cortesía de la interfaz.
 */
export function CopiarCartaDeSucursal({ origenes }: { origenes: OrigenCopiable[] }) {
  const idSelect = useId();
  const [origenId, setOrigenId] = useState(origenes[0]?.id ?? "");
  const origen = origenes.find((o) => o.id === origenId);
  if (!origenes.length) return <p className="text-sm text-neutral-500">Ninguna otra sucursal tiene carta propia para copiar todavía.</p>;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={idSelect} className="text-sm font-medium">
        Copiar de otra sucursal
      </label>
      <select id={idSelect} value={origenId} onChange={(e) => setOrigenId(e.target.value)} className="max-w-xs rounded border px-2 py-1">
        {origenes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre} ({o.cantidadProductos} producto(s))
          </option>
        ))}
      </select>
      <BotonConConfirmacion
        key={origenId}
        etiqueta="Copiar la carta"
        aviso={`¿Copiar la carta de «${origen?.nombre ?? ""}» a esta sucursal? Se copian los productos de la carta, los géneros y los ítems agrupados; después cada sucursal edita la suya.`}
        etiquetaConfirmar="Sí, copiar la carta"
        etiquetaEnCurso="Copiando…"
        etiquetaVolver="Volver"
        claseDisparador="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        accion={() => copiarCartaDeSucursal(origenId, true)}
      />
    </div>
  );
}
