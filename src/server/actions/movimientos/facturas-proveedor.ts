"use server";

import { guardComandoAceptarParteDeFactura, guardComandoAnularFacturaProveedor, guardComandoConfirmarRecepcionDeFactura, guardComandoCorregirFacturaProveedor, guardComandoRegistrarControlDeRecepcion, guardComandoRegistrarFacturaProveedor } from "@/core/features/compras/factura-proveedor.guard";
import type { CabeceraVista as CabeceraVistaSchema, CorreccionCompraInput as CorreccionCompraInputSchema } from "@/core/features/compras/compra.schema";
import type { ControlDeLineaInput, DatosFacturaProveedorInput, EntradaDeRecepcionInput } from "@/core/features/compras/factura-proveedor.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermiso, exigirTambienPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { aceptarPropuestaDeFacturaCasoDeUso } from "./casos-de-uso/aceptar-propuesta-de-factura";
import { anularFacturaProveedorCasoDeUso } from "./casos-de-uso/anular-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "./casos-de-uso/confirmar-recepcion-de-factura";
import { corregirFacturaProveedorCasoDeUso } from "./casos-de-uso/corregir-factura-proveedor";
import { registrarControlDeRecepcionCasoDeUso } from "./casos-de-uso/registrar-control-de-recepcion";
import { registrarFacturaProveedorCasoDeUso } from "./casos-de-uso/registrar-factura-proveedor";

/**
 * E3a (ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): las Server Actions de la factura de proveedor repartida entre sucursales por PROPUESTA y ACEPTACIÓN. Adaptadores finos: permiso →
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

/**
 * Compras, recepción separada (N3-a y N3-b): «Confirmar recepción» de una compra cargada «pendiente de recibir». Permiso `compra_recibir` en la sucursal activa (módulo `recepcion_de_compras`, piso administrador: gerente y administrador, no el
 * operador); la parte tiene que ser de esa sucursal (lo verifica el caso de uso). El actor y la hora salen del servidor; el cliente solo manda la factura, las entradas (renglón, sección y cantidad; un renglón se puede dividir entre secciones) y el día
 * de stock. Idempotente por estado: confirmar dos veces no carga stock de nuevo.
 */
export async function confirmarRecepcionDeFactura(facturaId: string, entradas: EntradaDeRecepcionInput[], fechaStock: Date): Promise<ResultadoAccion> {
  return conPermiso("compra_recibir", async (ctx) => {
    const comando = guardComandoConfirmarRecepcionDeFactura({ facturaId, entradas, fechaStock }, ctx.ahora);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await confirmarRecepcionDeFacturaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Compras, recepción separada (N3-b): «Registrar el control» de las líneas de una compra pendiente de recibir (conforme, con observaciones o rechazada). Permiso `compra_controlar_recepcion` en la sucursal activa (módulo `recepcion_de_compras`,
 * piso operario: lo registra «quien recibe», también el operador; confirmar sigue siendo del gerente y el administrador). Todo o nada; un renglón se controla una vez.
 */
export async function registrarControlDeRecepcion(facturaId: string, controles: ControlDeLineaInput[]): Promise<ResultadoAccion> {
  return conPermiso("compra_controlar_recepcion", async (ctx) => {
    const comando = guardComandoRegistrarControlDeRecepcion({ facturaId, controles });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await registrarControlDeRecepcionCasoDeUso(ctx, comando.valor, azarDelProceso));
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

/** Lo que se puede corregir de una factura ya cargada: solo la cabecera (proveedor, N.º de factura y detalle). Vive en `compra.schema.ts` (lo usa también el caso de uso). */
export type CorreccionDeFacturaInput = CorreccionCompraInputSchema;

/** Lo que la persona vio al abrir el formulario: la guarda optimista contra pisar una corrección hecha por otra persona. Vive en `compra.schema.ts`. */
export type CabeceraVista = CabeceraVistaSchema;

/**
 * «Corregir datos» de la compra (U1 de «una sola compra»): proveedor, N.º de factura y detalle de la FACTURA entera, sin tocar renglones ni Kardex (un precio o una cantidad mal cargados se arreglan anulando la factura y cargándola de
 * nuevo). Reemplaza a `corregirCompra`. Permiso `corregir_compra` en la sucursal activa y, dentro del caso de uso, en CADA sucursal donde ya entró una parte y en la que la cargó. Idempotente por estado: si ya tiene lo pedido, no hay
 * nada que corregir. `esperado` es lo que la persona vio al abrir el formulario (guarda optimista).
 */
export async function corregirFacturaProveedor(facturaId: string, nueva: CorreccionDeFacturaInput, esperado: CabeceraVista): Promise<ResultadoAccion> {
  return conPermiso("corregir_compra", async (ctx) => {
    const comando = guardComandoCorregirFacturaProveedor({ facturaId, nueva, esperado });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await corregirFacturaProveedorCasoDeUso(ctx, comando.valor));
  });
}
