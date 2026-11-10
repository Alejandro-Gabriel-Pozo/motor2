"use client";

import { useState } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { formatearEntero } from "@/core/formato-de-numero";
import { reemplazarCartaDeSucursal } from "@/server/actions/carta/copiar-carta";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

export interface CuentaDeCartaVisible {
  productos: number;
  itemsAgrupados: number;
  generos: number;
}

export interface OrigenReemplazable {
  id: string;
  nombre: string;
  cuenta: CuentaDeCartaVisible;
}

const detalle = (c: CuentaDeCartaVisible) => `${formatearEntero(c.productos)} producto(s) con contenido, ${formatearEntero(c.generos)} género(s) y ${formatearEntero(c.itemsAgrupados)} ítem(s) agrupado(s)`;

/**
 * «Reemplazar con la carta de otra sucursal» (pedido del dueño, 2026-11-10): solo se dibuja con la carta propia YA armada (sobre una carta vacía va «Copiar de otra sucursal»). Elegís el origen y la
 * confirmación dice qué se ELIMINA de esta sucursal y qué se COPIA, y exige escribir el nombre de esta sucursal (el botón de confirmar queda deshabilitado hasta que coincida). La acción vuelve a
 * comprobar todo en el servidor (permiso, origen, nombre); esto es cortesía de la interfaz. No hay «deshacer»: lo eliminado queda en el registro de auditoría.
 */
export function ReemplazarCartaDeSucursal({ origenes, destino }: { origenes: OrigenReemplazable[]; destino: { nombre: string; cuenta: CuentaDeCartaVisible } }) {
  const [origenId, setOrigenId] = useState(origenes[0]?.id ?? "");
  const [escrito, setEscrito] = useState("");
  const origen = origenes.find((o) => o.id === origenId);
  if (!origenes.length) return <p className="text-sm text-tinta-tenue">Ninguna otra sucursal tiene carta propia para reemplazar la de esta todavía.</p>;
  const coincide = escrito.trim().toLowerCase() === destino.nombre.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-2" data-reemplazar-carta>
      <Selector etiqueta="Reemplazar con la carta de" value={origenId} onChange={(e) => { setOrigenId(e.target.value); setEscrito(""); }} className="max-w-xs">
        {origenes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre} ({formatearEntero(o.cuenta.productos)} producto(s))
          </option>
        ))}
      </Selector>
      <BotonConConfirmacion
        key={origenId}
        etiqueta="Reemplazar la carta"
        aviso={
          <div className="flex flex-col gap-2">
            <p>
              ¿Reemplazar la carta de «{destino.nombre}» con la de «{origen?.nombre ?? ""}»? No se puede deshacer desde acá.
            </p>
            <p data-se-elimina>
              <b>Se elimina de «{destino.nombre}»:</b> {detalle(destino.cuenta)}.
            </p>
            <p data-se-copia>
              <b>Se copia de «{origen?.nombre ?? ""}»:</b> {origen ? detalle(origen.cuenta) : ""}.
            </p>
            <p>No se tocan las promos, los cupos, las secciones, el tema ni los precios. Lo eliminado queda guardado en el registro de auditoría.</p>
            <Campo etiqueta={`Para confirmar, escribí el nombre de esta sucursal: ${destino.nombre}`} value={escrito} onChange={(e) => setEscrito(e.target.value)} autoComplete="off" />
          </div>
        }
        confirmarDeshabilitado={!coincide}
        etiquetaConfirmar="Sí, reemplazar la carta"
        etiquetaEnCurso="Reemplazando…"
        etiquetaVolver="Volver"
        claseDisparador="self-start rounded bg-tinta px-3 py-1.5 text-sm text-superficie max-md:min-h-11"
        accion={() => reemplazarCartaDeSucursal(origenId, escrito)}
      />
    </div>
  );
}
