"use server";

import { aResultadoAccion } from "@/core/resultado-caso";
import { guardComandoRegistrarPagoConsignante } from "@/core/features/reportes/pago-consignante.guard";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { registrarPagoConsignanteCasoDeUso } from "./casos-de-uso/registrar-pago-consignante";

/**
 * Registra un pago a un proveedor de consignación, para saldar (parcial o
 * totalmente) su "Debido por consignante" (ver core/reportes/consignacion.ts)
 * — antes no existía ninguna acción para esto: el saldo solo podía crecer
 * (hallazgo de la auditoría de motor2). Append-only, igual que el resto
 * del Kardex: nunca se tocan las líneas LIQUIDACION_CONSIGNACION, esto es
 * un registro aparte que el reporte resta.
 *
 * Desde la Task #41 (Fase M, M14 — docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso("pagar_consignante")`) → formato del comando (`guardComandoRegistrarPagoConsignante`,
 * `core/features/reportes/pago-consignante.guard.ts`: proveedor en blanco, importe, formato de la clave I3) → caso de uso
 * (`casos-de-uso/registrar-pago-consignante.ts`: idempotencia I3, transacción, persistencia, auditoría) → `aResultadoAccion`. Antes
 * no tenía transacción, idempotencia ni auditoría — un doble clic real registraba el pago dos veces (hallazgo del backlog, M14).
 */
export async function registrarPagoConsignante(
  proveedorId: string,
  importe: number,
  fecha: Date,
  notas?: string,
  claveIdempotencia?: string
): Promise<ResultadoAccion> {
  return conPermiso("pagar_consignante", async (ctx) => {
    const comando = guardComandoRegistrarPagoConsignante({ proveedorId, importe, fecha, notas, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await registrarPagoConsignanteCasoDeUso(ctx, comando.valor));
  });
}
