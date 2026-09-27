import type { EstadoTraspaso } from "@prisma/client";
import type { ResultadoCaso } from "@/core/resultado-caso";

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

/*
 * Comandos y resultados de los casos de uso de traspasos (Task #41, Fase M11a — docs/arquitectura-casos-de-uso-2026-09-27.md):
 * `src/server/actions/traspasos/casos-de-uso/` (`aprobar-y-enviar-traspaso.ts`, `cancelar-solicitud-de-traspaso.ts`,
 * `rechazar-solicitud-de-traspaso.ts`). Los comandos llegan YA validados por los guards de `traspaso-comandos.guard.ts`.
 */

/** Comando «aprobar y enviar una solicitud» (Origen): el traspaso y la sección PROPIA de la que sale el stock. */
export interface ComandoAprobarYEnviarTraspaso {
  /** Id del traspaso, ya normalizado con `texto()` y no vacío. */
  traspasoId: string;
  /** La sección tal cual llegó (string): que sea de ESTA sucursal lo decide el caso de uso contra la base. */
  seccionOrigenId: string;
}

/** Comando «cancelar mi propia solicitud» (Destino). */
export interface ComandoCancelarSolicitudTraspaso {
  traspasoId: string;
}

/** Comando «rechazar una solicitud» (Origen). */
export interface ComandoRechazarSolicitudTraspaso {
  traspasoId: string;
  /** Ya normalizado: `texto(motivo) || null`, igual que antes. */
  motivo: string | null;
}

/** Por qué no se pudo cambiar el estado: no existe, o el guard de transición (`LADO` / `ESTADO`, ver `ResultadoTransicionTraspaso`). */
export type CodigoTransicionTraspaso = "NO_ENCONTRADO" | Extract<ResultadoTransicionTraspaso, { ok: false }>["motivo"];

export type CodigoAprobarYEnviarTraspaso = CodigoTransicionTraspaso | "SECCION_NO_PROPIA" | "PRODUCTO_NO_TRANSFERIBLE" | "STOCK_INSUFICIENTE";

/** `datos` de una aprobación: la Operación de SALIDA escrita y lo que salió de la sección de origen. */
export interface DatosAprobarYEnviarTraspaso {
  traspasoId: string;
  operacionId: string;
  seccionOrigenId: string;
  cantidad: number;
}

export type ResultadoAprobarYEnviarTraspaso = ResultadoCaso<DatosAprobarYEnviarTraspaso, CodigoAprobarYEnviarTraspaso>;

/** `datos` de un cierre de solicitud (cancelada o rechazada): nunca tocó stock, solo cambia el estado. */
export interface DatosCierreDeSolicitudTraspaso {
  traspasoId: string;
  estadoNuevo: EstadoTraspaso;
}

export type ResultadoCancelarSolicitudTraspaso = ResultadoCaso<DatosCierreDeSolicitudTraspaso, CodigoTransicionTraspaso>;
export type ResultadoRechazarSolicitudTraspaso = ResultadoCaso<DatosCierreDeSolicitudTraspaso, CodigoTransicionTraspaso>;
