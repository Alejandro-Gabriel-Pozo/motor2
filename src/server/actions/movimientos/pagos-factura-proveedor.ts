"use server";

import { guardComandoAnularPagoDeFactura, guardComandoDeclararPagoDeFactura } from "@/core/features/compras/factura-proveedor.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { anularPagoDeFacturaCasoDeUso } from "./casos-de-uso/anular-pago-de-factura-proveedor";
import { declararPagoDeFacturaCasoDeUso } from "./casos-de-uso/declarar-pago-de-factura-proveedor";

/**
 * Pagos X0 (docs/diseno-pagos-x0-2026-11-04.md): las dos Server Actions del pago declarado de una factura de proveedor. Adaptadores finos: permiso de EMPRESA `declarar_pago_compra` → formato → caso de uso →
 * `aResultadoAccion`. Ninguna refresca la vista: quien llama es un componente de cliente que pide el `router.refresh()` él mismo.
 */

/** «Declarar pago»: la factura, el día del pago (`AAAA-MM-DD`, Argentina) y el medio. */
export async function declararPagoDeFacturaProveedor(facturaId: string, fechaPago: string, medio: string, claveIdempotencia: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("declarar_pago_compra", async (ctx) => {
    const comando = guardComandoDeclararPagoDeFactura({ facturaId, fechaPago, medio, claveIdempotencia }, ctx.ahora);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await declararPagoDeFacturaCasoDeUso(ctx, comando.valor));
  });
}

/** «Anular pago»: el pago y el motivo. */
export async function anularPagoDeFacturaProveedor(pagoId: string, motivo: string, claveIdempotencia: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("declarar_pago_compra", async (ctx) => {
    const comando = guardComandoAnularPagoDeFactura({ pagoId, motivo, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularPagoDeFacturaCasoDeUso(ctx, comando.valor));
  });
}
