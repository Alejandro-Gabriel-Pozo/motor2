"use client";

import { useState } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { anularFacturaProveedor } from "@/server/actions/movimientos/facturas-proveedor";
import { Campo } from "@/ui/primitivas/campo";

/**
 * E3a (ADR-041): «Anular factura» desde la compra que es la parte de esta sucursal en una factura de proveedor. Anula la factura ENTERA: revierte el stock de todas sus partes ya aceptadas (si alguna ya se usó, no
 * anula nada), las partes que faltaba aceptar ya no se pueden aceptar y el número queda libre para volver a cargarla. Pide el motivo (queda en el registro de la anulación) y confirmación; la clave de reintento se
 * genera al abrir la confirmación (`BotonConConfirmacion`).
 */
export function BotonAnularFactura({ facturaId, resumen, anulada }: { facturaId: string; resumen: string; anulada: boolean }) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {!anulada && <Campo etiqueta="Motivo de la anulación de la factura" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />}
      <BotonConConfirmacion
        etiqueta="Anular factura entera"
        etiquetaAccesible={`Anular la factura ${resumen}`}
        aviso={`¿Anular la factura ${resumen} entera? Revierte el stock de todas sus partes ya aceptadas y las que faltaba aceptar ya no se podrán aceptar. No se puede deshacer.`}
        etiquetaConfirmar="Sí, anular la factura"
        etiquetaEnCurso="Anulando…"
        accion={(claveIdempotencia) => anularFacturaProveedor(facturaId, motivo, claveIdempotencia)}
        hecho={anulada}
        deshabilitado={!motivo.trim()}
      />
    </div>
  );
}
