"use server";

import { guardComandoReclasificarStock } from "@/core/features/movimientos/reclasificacion.guard";
import type {
  ComandoReclasificarStock as ComandoReclasificarStockSchema,
  DestinoReclasificacion as DestinoReclasificacionSchema,
} from "@/core/features/movimientos/reclasificacion.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { reclasificarStockCasoDeUso } from "./casos-de-uso/reclasificar-stock";

/** Un destino de la reclasificación. Vive en `reclasificacion.schema.ts` (lo usa también el caso de uso). */
export type DestinoReclasificacion = DestinoReclasificacionSchema;

/** Lo que recibe `reclasificarStock`. Vive en `reclasificacion.schema.ts` (lo usa también el caso de uso). */
export type DatosReclasificacion = ComandoReclasificarStockSchema;

/**
 * Port de dividirClasificacionStock_ (Stock.js:1899-1991, wrapper público
 * reclasificarStock) — primitiva de split genérico: reparte TODO el saldo
 * disponible de un producto en un origen (sección+lote puntual) entre 1+
 * destinos (sección+lote cada uno), ni de más ni de menos. Mismo permiso
 * que Conteo Físico ('proceso_control') — no pasa por TRANSICIONES ni por
 * registrarMovimiento, mismo criterio que Apps Script: no es una acción de
 * usuario con su propia Accion, es la herramienta de corrección que ofrece
 * el panel de Conteo Físico.
 *
 * Desde la Task #41 (Fase M, M13d — docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso("stock_reclasificar")`) → formato del comando (`guardComandoReclasificarStock`,
 * core/features/movimientos/reclasificacion.guard.ts: producto, sección de origen, destinos vacío, clave I3, sección de cada destino en
 * blanco) → caso de uso (`casos-de-uso/reclasificar-stock.ts`: secciones propias, "único destino idéntico al origen", transacción,
 * idempotencia, persistencia) → `aResultadoAccion`.
 *
 * `obtenerSaldoDisponibleParaReclasificar` (solo lectura) se mudó a `lecturas-reclasificacion.ts` — con `reclasificarStock` ya migrado,
 * este archivo no tiene ninguna otra función y entró en `ACCIONES_CON_CASO_DE_USO` (.dependency-cruiser-excepciones.cjs).
 */
export async function reclasificarStock(datos: DatosReclasificacion): Promise<ResultadoAccion> {
  return conPermiso("stock_reclasificar", async (ctx) => {
    const comando = guardComandoReclasificarStock(datos);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await reclasificarStockCasoDeUso(ctx, comando.valor));
  });
}
