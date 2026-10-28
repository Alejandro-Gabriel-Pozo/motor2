"use server";

import { guardComandoAceptarParteDeFactura, guardComandoAnularFacturaProveedor, guardComandoRegistrarFacturaProveedor } from "@/core/features/compras/factura-proveedor.guard";
import type { DatosFacturaProveedorInput } from "@/core/features/compras/factura-proveedor.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso, exigirTambienPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { aceptarPropuestaDeFacturaCasoDeUso } from "./casos-de-uso/aceptar-propuesta-de-factura";
import { anularFacturaProveedorCasoDeUso } from "./casos-de-uso/anular-factura-proveedor";
import { registrarFacturaProveedorCasoDeUso } from "./casos-de-uso/registrar-factura-proveedor";

/**
 * E3a (ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): las tres Server Actions de la factura de proveedor repartida entre sucursales por PROPUESTA y ACEPTACIÓN. Adaptadores finos: permiso →
 * formato → caso de uso → `aResultadoAccion`. Ninguna refresca la vista: quien llama es un componente de cliente que pide el `router.refresh()` él mismo.
 */

/**
 * «Cargar factura» desde la Compra de la sucursal activa (la que compra). Permiso `proceso_compra` en ella y, si alguna parte es de OTRA sucursal, también `compra_repartir` (clave de empresa, piso operario
 * desde E3a: el gerente la asigna en la matriz a quien reparte). Las ids de las otras sucursales solo se usan como DESTINO de una propuesta pendiente: la carga nunca escribe stock ni partes en ellas.
 */
export async function registrarFacturaProveedor(datos: DatosFacturaProveedorInput): Promise<ResultadoAccion> {
  return conPermiso("proceso_compra", async (ctx) => {
    const comando = guardComandoRegistrarFacturaProveedor(datos, ctx.ahora, ctx.sucursalId);
    if (!comando.ok) return error(comando.mensaje);
    if (comando.valor.reparto.partes.some((p) => p.sucursalId !== ctx.sucursalId)) {
      const tambien = await exigirTambienPermisoDeEmpresa(ctx, "compra_repartir");
      if (!tambien.ok) return error(tambien.mensaje);
    }
    return aResultadoAccion(await registrarFacturaProveedorCasoDeUso(ctx, comando.valor));
  });
}

/** «Aceptar mi parte»: la sucursal activa tiene que ser la destino de la propuesta (lo verifica el caso de uso). Permiso `proceso_compra` en ella (decisión del dueño, 2026-10-28). */
export async function aceptarPropuestaDeFactura(propuestaId: string, seccionId: string, fechaStock: Date, claveIdempotencia: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_compra", async (ctx) => {
    const comando = guardComandoAceptarParteDeFactura({ propuestaId, seccionId, fechaStock, claveIdempotencia }, ctx.ahora);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await aceptarPropuestaDeFacturaCasoDeUso(ctx, comando.valor));
  });
}

/** «Anular factura» (administrador): `anular_compra` en la sucursal activa y, dentro del caso de uso, en CADA sucursal donde ya entró una parte. */
export async function anularFacturaProveedor(facturaId: string, motivo: string, claveIdempotencia: string): Promise<ResultadoAccion> {
  return conPermiso("anular_compra", async (ctx) => {
    const comando = guardComandoAnularFacturaProveedor({ facturaId, motivo, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularFacturaProveedorCasoDeUso(ctx, comando.valor));
  });
}
