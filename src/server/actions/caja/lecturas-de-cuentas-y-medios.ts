"use server";

import { listarCuentasDeCobroDeAdministracion, listarMediosDePagoDeAdministracion, type CuentaDeCobroDeAdministracion, type MedioDePagoDeAdministracion } from "@/server/lecturas/caja/administracion-de-cobro";
import { requerirVer } from "../con-sesion";

/**
 * Las DOS LECTURAS de administración de la caja (etapa B; docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md §5, decisión Q-B2: sin clave «ver» propia): cada una pide `caja_ver` en la sucursal ACTIVA como primera línea (`requerirVer`, igual que
 * `lecturas-de-caja.ts`) y llama a su lectura de `server/lecturas/caja/` con la empresa del CONTEXTO (nunca una que mande el navegador). Devuelven solo datos de lectura como texto, números y booleanos.
 */

/** Las cuentas de cobro de las sucursales del alcance del usuario (activas e inactivas), con su tipo, identificador, versión y sucursal. */
export async function leerCuentasDeCobroDeAdministracion(): Promise<CuentaDeCobroDeAdministracion[]> {
  const ctx = await requerirVer("caja_ver");
  return listarCuentasDeCobroDeAdministracion(ctx.empresaId, ctx.db);
}

/** Los medios de pago de la empresa (activos e inactivos), con qué datos pide cada uno y su versión. */
export async function leerMediosDeCobroDeAdministracion(): Promise<MedioDePagoDeAdministracion[]> {
  const ctx = await requerirVer("caja_ver");
  return listarMediosDePagoDeAdministracion(ctx.empresaId, ctx.db);
}
