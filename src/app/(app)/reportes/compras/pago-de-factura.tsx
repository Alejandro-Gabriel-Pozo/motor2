"use client";

import { useState } from "react";
import type { PagoDeCompra } from "@/core/reportes/public";
import { ETIQUETA_DE_MEDIO_DE_PAGO, MEDIOS_DE_PAGO, etiquetaDeEstadoDePago } from "@/core/compras/public";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { anularPagoDeFacturaProveedor, declararPagoDeFacturaProveedor } from "@/server/actions/movimientos/pagos-factura-proveedor";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";

/**
 * Pagos X0 (docs/diseno-pagos-x0-2026-11-04.md): el estado de pago de una factura de proveedor en «Compras registradas» y, para quien tiene `declarar_pago_compra`, «Declarar pago» (fecha y medio, una factura
 * `PENDIENTE_DE_PAGO` sin pago vigente) y «Anular pago» (con motivo). La clave de reintento se genera al abrir cada confirmación (`BotonConConfirmacion`); el servidor decide todo (permiso, fecha, estado): acá solo se
 * evita enviar lo evidentemente incompleto. `hoy` es el día argentino del servidor (tope del selector de fecha, que es una guía y no una validación).
 */
export function PagoDeFactura({ facturaId, resumen, pago, puedeDeclarar, hoy, desde }: { facturaId: string; resumen: string; pago: PagoDeCompra; puedeDeclarar: boolean; hoy: string; desde: string }) {
  const [fechaPago, setFechaPago] = useState(hoy);
  const [medio, setMedio] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <div className="flex flex-col gap-2" data-testid="pago-de-factura">
      <p className="text-sm" data-testid="estado-de-pago">
        <span className="font-medium">Pago:</span> {etiquetaDeEstadoDePago(pago.estado, pago.pagoVigente ?? undefined)}
      </p>
      {puedeDeclarar && pago.estado === "PENDIENTE" && (
        <div className="flex flex-col gap-2">
          <CampoFecha etiqueta="Fecha en que se pagó" tamano="compacto" value={fechaPago} min={desde} max={hoy} onChange={(e) => setFechaPago(e.target.value)} />
          <Selector etiqueta="Medio de pago" tamano="compacto" value={medio} onChange={(e) => setMedio(e.target.value)}>
            <option value="">Elegí el medio</option>
            {MEDIOS_DE_PAGO.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_DE_MEDIO_DE_PAGO[m]}
              </option>
            ))}
          </Selector>
          <BotonConConfirmacion
            etiqueta="Declarar pago"
            etiquetaAccesible={`Declarar el pago de la factura ${resumen}`}
            aviso={`¿Declarar la factura ${resumen} como pagada el ${fechaPago}? Si te equivocás, podés anular el pago y volver a declararlo.`}
            etiquetaConfirmar="Sí, declarar el pago"
            etiquetaEnCurso="Declarando…"
            accion={(claveIdempotencia) => declararPagoDeFacturaProveedor(facturaId, fechaPago, medio, claveIdempotencia)}
            deshabilitado={!fechaPago || !medio}
          />
        </div>
      )}
      {puedeDeclarar && pago.estado === "PAGADA" && pago.pagoVigente && (
        <div className="flex flex-col gap-2">
          <Campo etiqueta="Motivo de la anulación del pago" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
          <BotonConConfirmacion
            etiqueta="Anular pago"
            etiquetaAccesible={`Anular el pago de la factura ${resumen}`}
            aviso={`¿Anular el pago de la factura ${resumen}? Queda registrado con su motivo y la factura vuelve a estar pendiente de pago.`}
            etiquetaConfirmar="Sí, anular el pago"
            etiquetaEnCurso="Anulando…"
            accion={(claveIdempotencia) => anularPagoDeFacturaProveedor(pago.pagoVigente!.pagoId, motivo, claveIdempotencia)}
            deshabilitado={!motivo.trim()}
          />
        </div>
      )}
    </div>
  );
}
