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

/*
 * Comandos y resultados de la RECEPCIÓN de un envío (Task #41, Fase M11b — docs/arquitectura-casos-de-uso-2026-09-27.md):
 * `src/server/actions/traspasos/casos-de-uso/` (`aceptar-traspaso.ts`, `rechazar-envio-de-traspaso.ts`,
 * `confirmar-reingreso-de-traspaso.ts`). Los comandos llegan YA validados por los guards de `traspaso-comandos.guard.ts`.
 */

/** Comando «aceptar un envío» (Destino): el traspaso, la sección PROPIA a la que entra el stock y la clave I3 opcional. */
export interface ComandoAceptarTraspaso {
  traspasoId: string;
  /** La sección tal cual llegó (string): que sea de ESTA sucursal lo decide el caso de uso contra la base. Entra así al hash I3. */
  seccionDestinoId: string;
  /** Clave I3 ya validada (UUID), o `null` si no vino ninguna. */
  claveIdempotencia: string | null;
}

/** Comando «rechazar un envío» (Destino). Sin I3: no escribe ninguna Operación donde guardarla. */
export interface ComandoRechazarEnvioTraspaso {
  traspasoId: string;
  /** Ya normalizado: `texto(motivo) || null`, igual que antes. */
  motivo: string | null;
}

/** Comando «confirmar el reingreso» (Origen, tras un rechazo de Destino), con la clave I3 opcional. */
export interface ComandoConfirmarReingresoTraspaso {
  traspasoId: string;
  claveIdempotencia: string | null;
}

/** `datos` de una recepción de stock (aceptación o reingreso). En un reenvío I3 (`repetida: true`) no se escribió nada: `operacionId` es `null`. */
export interface DatosEntradaDeTraspaso {
  traspasoId: string;
  operacionId: string | null;
  repetida: boolean;
}

export type CodigoAceptarTraspaso = CodigoTransicionTraspaso | "SECCION_NO_PROPIA" | "PRODUCTO_NO_TRANSFERIBLE" | "CONFLICTO_IDEMPOTENCIA";
export type ResultadoAceptarTraspaso = ResultadoCaso<DatosEntradaDeTraspaso, CodigoAceptarTraspaso>;

/** `datos` de un rechazo de envío: todavía no toca stock (el reingreso lo confirma Origen aparte), solo cambia el estado. */
export interface DatosRechazoDeEnvioTraspaso {
  traspasoId: string;
  estadoNuevo: EstadoTraspaso;
}

export type ResultadoRechazarEnvioTraspaso = ResultadoCaso<DatosRechazoDeEnvioTraspaso, CodigoTransicionTraspaso>;

export type CodigoConfirmarReingresoTraspaso = CodigoTransicionTraspaso | "SIN_SECCION_ORIGEN" | "CONFLICTO_IDEMPOTENCIA";
export type ResultadoConfirmarReingresoTraspaso = ResultadoCaso<DatosEntradaDeTraspaso, CodigoConfirmarReingresoTraspaso>;

/*
 * Comandos y resultados de la CREACIÓN de un traspaso (Task #41, Fase M11c — docs/arquitectura-casos-de-uso-2026-09-27.md):
 * `src/server/actions/traspasos/casos-de-uso/` (`crear-solicitud-de-traspaso.ts`, `crear-envio-directo-de-traspaso.ts`). Los comandos
 * llegan YA validados por los guards de `traspaso-comandos.guard.ts`.
 */

/** Comando «pedir una transferencia» (PULL; Destino = quien actúa): de qué sucursal, qué producto, cuánto y a qué sección propia entra. */
export interface ComandoCrearSolicitudTraspaso {
  /** La sucursal a la que se le pide (Origen), ya normalizada con `texto()` y no vacía. */
  origenSucursalId: string;
  /** El producto tal cual llegó (string): que exista y sea transferible lo decide el caso de uso contra la base. */
  productoId: string;
  /** La cantidad TAL CUAL llegó: se valida en el caso de uso contra los decimales de la unidad de stock del producto. */
  cantidad: unknown;
  /** La sección tal cual llegó (string): que sea de ESTA sucursal lo decide el caso de uso contra la base. */
  seccionDestinoId: string;
  /** Ya normalizado: `texto(detalle) || null`, igual que antes. */
  detalle: string | null;
}

/** Comando «enviar directo» (PUSH; Origen = quien actúa): a qué sucursal, qué producto, cuánto y de qué sección propia sale. */
export interface ComandoCrearEnvioDirectoTraspaso {
  /** La sucursal a la que se le manda (Destino), ya normalizada con `texto()` y no vacía. */
  destinoSucursalId: string;
  productoId: string;
  cantidad: unknown;
  seccionOrigenId: string;
  detalle: string | null;
}

/** Por qué no se pudo crear el traspaso (común a los dos sentidos). */
export type CodigoCrearTraspaso = "MISMA_SUCURSAL" | "SUCURSAL_NO_DISPONIBLE" | "SECCION_NO_PROPIA" | "PRODUCTO_NO_TRANSFERIBLE" | "CANTIDAD_INVALIDA";

/** `datos` de una creación: el traspaso nuevo y el nombre del producto (lo que la Server Action devuelve como `id`/`nombre`). */
export interface DatosCreacionDeTraspaso {
  traspasoId: string;
  productoNombre: string;
}

export type ResultadoCrearSolicitudTraspaso = ResultadoCaso<DatosCreacionDeTraspaso, CodigoCrearTraspaso>;

/** `datos` de un envío directo: además, la Operación de SALIDA escrita y lo que salió de la sección de origen. */
export interface DatosEnvioDirectoDeTraspaso extends DatosCreacionDeTraspaso {
  operacionId: string;
  seccionOrigenId: string;
  cantidad: number;
}

export type ResultadoCrearEnvioDirectoTraspaso = ResultadoCaso<DatosEnvioDirectoDeTraspaso, CodigoCrearTraspaso | "STOCK_INSUFICIENTE">;
