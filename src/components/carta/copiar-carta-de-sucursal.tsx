"use client";

import { useState } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { copiarCartaDeSucursal } from "@/server/actions/carta/copiar-carta";
import { Selector } from "@/ui/primitivas/selector";

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
  const [origenId, setOrigenId] = useState(origenes[0]?.id ?? "");
  const origen = origenes.find((o) => o.id === origenId);
  if (!origenes.length) return <p className="text-sm text-tinta-tenue">Ninguna otra sucursal tiene carta propia para copiar todavía.</p>;

  return (
    <div className="flex flex-col gap-2">
      <Selector etiqueta="Copiar de otra sucursal" value={origenId} onChange={(e) => setOrigenId(e.target.value)} className="max-w-xs">
        {origenes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre} ({o.cantidadProductos} producto(s))
          </option>
        ))}
      </Selector>
      <BotonConConfirmacion
        key={origenId}
        etiqueta="Copiar la carta"
        aviso={`¿Copiar la carta de «${origen?.nombre ?? ""}» a esta sucursal? Se copian los productos de la carta, los géneros y los ítems agrupados; después cada sucursal edita la suya.`}
        etiquetaConfirmar="Sí, copiar la carta"
        etiquetaEnCurso="Copiando…"
        etiquetaVolver="Volver"
        claseDisparador="self-start rounded bg-tinta px-3 py-1.5 text-sm text-superficie max-md:min-h-11"
        accion={() => copiarCartaDeSucursal(origenId, true)}
      />
    </div>
  );
}
