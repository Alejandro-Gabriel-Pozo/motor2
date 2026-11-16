"use server";

import { consultarEstadoDeCaja, type EstadoDeCaja } from "@/server/consultas/caja/estado-de-caja";
import { listarCobranzasDeSesion, type CobranzaDeSesion } from "@/server/consultas/caja/cobranzas-de-sesion";
import { listarCuentasSinCobrar, type PaginaDeCuentasSinCobrar } from "@/server/consultas/caja/cuentas-sin-cobrar";
import { listarMediosDePagoActivos, type MedioDePagoActivo } from "@/server/consultas/caja/medios-de-pago";
import { requerirVer } from "../con-sesion";

/**
 * Las LECTURAS de la caja (etapa C1, PR-B; docs/diseno-caja-c1-pr-b-permisos-acciones-y-consultas-2026-11-16.md): cada una pide `caja_ver` en la sucursal ACTIVA como primera línea (`requerirVer`) y llama a su consulta de `server/consultas/caja/` con la
 * sucursal y la empresa del CONTEXTO (nunca una que mande el navegador). Devuelven solo datos de lectura: importes en CENTAVOS como texto, sin datos personales del cliente. El reloj se lee acá, en el borde, y se le pasa a la consulta.
 */

/** El estado de la caja de la sucursal activa: la sesión abierta con lo esperado y sus movimientos, o `null` si está cerrada. */
export async function leerEstadoDeCaja(): Promise<EstadoDeCaja> {
  const ctx = await requerirVer("caja_ver");
  return consultarEstadoDeCaja(ctx.sucursalId, ctx.db);
}

/** Las cuentas cerradas con venta que todavía no se cobraron en la sucursal activa, de a una página; `cursor` es el `nextCursor` de la página anterior. */
export async function leerCuentasSinCobrar(cursor?: string): Promise<PaginaDeCuentasSinCobrar> {
  const ctx = await requerirVer("caja_ver");
  return listarCuentasSinCobrar({ empresaId: ctx.empresaId, sucursalId: ctx.sucursalId, ahora: new Date(), ...(typeof cursor === "string" && cursor !== "" ? { cursor } : {}) }, ctx.db);
}

/** Las cuentas cobradas en una sesión de caja de la sucursal activa (con sus renglones y medios, sin datos personales). Una sesión de otra sucursal devuelve vacío. */
export async function leerCobranzasDeSesion(sesionId: string): Promise<CobranzaDeSesion[]> {
  const ctx = await requerirVer("caja_ver");
  return listarCobranzasDeSesion({ sucursalId: ctx.sucursalId, sesionId: String(sesionId) }, ctx.db);
}

/** Los medios de pago activos de la empresa, para elegir con cuál se cobra. */
export async function leerMediosDeCobro(): Promise<MedioDePagoActivo[]> {
  const ctx = await requerirVer("caja_ver");
  return listarMediosDePagoActivos(ctx.empresaId, ctx.db);
}
