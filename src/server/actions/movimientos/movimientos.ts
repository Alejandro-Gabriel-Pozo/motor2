"use server";

import { ACCION_POR_PROCESO } from "@/core/movimientos/public";
import { guardComandoRegistrarMovimiento } from "@/core/features/movimientos/movimiento.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import type {
  DatosMovimientoInput as DatosMovimientoInputSchema,
  ItemMovimientoInput as ItemMovimientoInputSchema,
} from "@/core/features/movimientos/movimiento.schema";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { registrarMovimientoCasoDeUso } from "./casos-de-uso/registrar-movimiento";

/**
 * `ProcesoGenerico` (los procesos que pasan por este motor) NO se reexporta acá: vive solo en `movimiento.schema.ts` — nadie lo
 * importaba de este archivo (knip lo marca "export sin consumidor real" si se reexporta sin uso; ver el punto 1 del diseño de M13a).
 */

/** Una línea del movimiento. Vive en `movimiento.schema.ts` (lo usa también el caso de uso). */
export type ItemMovimientoInput = ItemMovimientoInputSchema;

/** Lo que recibe `registrarMovimiento`. Vive en `movimiento.schema.ts` (lo usa también el caso de uso). */
export type DatosMovimientoInput = DatosMovimientoInputSchema;

/**
 * Port de confirmarRegistrarMovimientos (Movimientos.js:876-1136) para los
 * 9 procesos que comparten este motor (Compra, Producción, Consumo,
 * Ajuste, Transferencia, Merma, Devolución×3) — Venta y Control (Conteo
 * Físico) tienen su propia acción, ver registrarVenta/registrarConteoFisico.
 *
 * Desde la Task #41 (Fase M, M13a-c — docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: el
 * permiso a pedir sale de `ACCION_POR_PROCESO[datos.proceso]` (ANTES de `conPermiso`, tal cual siempre) → `conPermiso` → formato
 * del comando (`guardComandoRegistrarMovimiento`, core/features/movimientos/movimiento.guard.ts: proceso genérico, items vacío,
 * sección en blanco, formato de la clave I3, Transferencia con destino vacío/igual al origen) → caso de uso
 * (`casos-de-uso/registrar-movimiento.ts`: sección propia, motivo/destino, factura, idempotencia, transacción, persistencia y el
 * hookup de proveedor) → `aResultadoAccion`.
 */
export async function registrarMovimiento(datos: DatosMovimientoInput): Promise<ResultadoAccion> {
  const accionClave = ACCION_POR_PROCESO[datos.proceso];
  if (!accionClave) return error(`Proceso "${datos.proceso}" no se registra con esta acción.`);

  return conPermiso(accionClave, async (ctx) => {
    const comando = guardComandoRegistrarMovimiento(datos);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await registrarMovimientoCasoDeUso(ctx, comando.valor));
  });
}
