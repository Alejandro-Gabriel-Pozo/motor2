import type { EstadoTraspaso } from "@prisma/client";

/**
 * Tipos del guard de transición de un Traspaso entre sucursales, para `traspaso.guard.ts` (convención "guard por feature",
 * 2026-09-25: `src/core/features/<feature>/<feature>.guard.ts`, ver `src/core/features/compras/`).
 */

/** Cada paso del ciclo de un traspaso que cambia su estado desde la Bandeja (ver `src/server/actions/traspasos/traspasos.ts`). */
export type OperacionTraspaso = "aprobar" | "rechazar_solicitud" | "cancelar_solicitud" | "aceptar" | "rechazar_envio" | "confirmar_reingreso";

/** Lo mínimo del traspaso que necesita el guard: el estado actual y de qué lado está cada sucursal. */
export interface TraspasoParaGuard {
  estado: EstadoTraspaso;
  origenSucursalId: string;
  destinoSucursalId: string;
}

/** Misma forma que `evaluarAnulacion` (src/core/compras/anulacion.ts): ok con el estado al que pasa, o el motivo y el mensaje para el usuario. */
export type ResultadoTransicionTraspaso =
  | { ok: true; estadoNuevo: EstadoTraspaso }
  | { ok: false; motivo: "LADO" | "ESTADO"; mensaje: string };
