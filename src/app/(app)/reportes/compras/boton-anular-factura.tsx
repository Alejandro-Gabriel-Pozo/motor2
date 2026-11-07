"use client";

import { useState } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { anularFacturaProveedor } from "@/server/actions/movimientos/facturas-proveedor";
import { Campo } from "@/ui/primitivas/campo";

/**
 * «Anular compra» del detalle de una compra registrada (K1c, E3a; desde U1 de «una sola compra» es la ÚNICA anulación: toda compra es una factura de una o más partes). Anula la factura ENTERA: revierte el stock de todas sus
 * partes ya aceptadas (si alguna ya se usó, no anula nada), las partes que faltaba aceptar ya no se pueden aceptar y el número queda libre para volver a cargarla. Pide el motivo (queda en el registro de la anulación) y confirmación;
 * la clave de reintento se genera al abrir la confirmación (`BotonConConfirmacion`: foco a «Cancelar», aviso con `role="alert"`, Escape cancela).
 */
export function BotonAnularFactura({ facturaId, resumen, anulada }: { facturaId: string; resumen: string; anulada: boolean }) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {!anulada && <Campo etiqueta="Motivo de la anulación" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />}
      <BotonConConfirmacion
        etiqueta="Anular compra"
        etiquetaAccesible={`Anular compra ${resumen}`}
        aviso={`¿Anular la compra ${resumen}? Revierte el stock de lo que se compró (en todas las sucursales que ya recibieron su parte), la saca del gasto y las partes que faltaba aceptar ya no se podrán aceptar. No se puede deshacer.`}
        etiquetaConfirmar="Sí, anular"
        etiquetaEnCurso="Anulando…"
        accion={(claveIdempotencia) => anularFacturaProveedor(facturaId, motivo, claveIdempotencia)}
        hecho={anulada}
        deshabilitado={!motivo.trim()}
      />
    </div>
  );
}
