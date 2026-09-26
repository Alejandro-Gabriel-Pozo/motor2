import type { EstadoTraspaso } from "@prisma/client";
import type { OperacionTraspaso, ResultadoTransicionTraspaso, TraspasoParaGuard } from "./traspaso.schema";

/**
 * Guard de TRANSICIÓN de un Traspaso entre sucursales (convención "guard por feature", 2026-09-25;
 * docs/plan-mutaciones-controladas-2026-09-25.md). Puro: sin Prisma ni permisos.
 *
 * Decide si la sucursal que actúa puede hacer ESTA operación sobre ESTE traspaso — de qué lado tiene que estar (origen o destino) y
 * desde qué estado — y a qué estado pasa. Antes estos dos chequeos estaban repetidos en línea en cada una de las 6 Server Actions de
 * `src/server/actions/traspasos/traspasos.ts`, con los estados escritos a mano en cada una; los mensajes son EXACTAMENTE los de
 * entonces (hay tests que los comparan).
 *
 * Queda en la Server Action todo lo que necesita la base: que el traspaso exista, la disponibilidad del producto, el stock, la
 * sección de origen para el reingreso — mismo reparto que `guardLineaCompra` (src/core/features/compras/compra.guard.ts). La
 * Server Action tiene que llamar a este guard DENTRO de la misma transacción serializable en la que escribe el estado nuevo: el
 * guard dice si la transición vale para el estado LEÍDO, y solo la transacción garantiza que ese estado siga siendo el actual al
 * escribir (ver `rechazarTransferencia`).
 */

interface Transicion {
  /** De qué lado tiene que estar la sucursal que actúa. */
  lado: "origen" | "destino";
  desde: EstadoTraspaso;
  hacia: EstadoTraspaso;
  /** El error cuando la sucursal no está de ese lado. */
  mensajeLado: string;
  /** El error cuando el traspaso no está en `desde`. */
  mensajeEstado: (estado: EstadoTraspaso) => string;
}

const NO_ES_ORIGEN = "Este traspaso no está dirigido a esta sucursal como origen.";
const NO_ES_DESTINO = "Este traspaso no está dirigido a esta sucursal como destino.";

export const TRANSICIONES_TRASPASO: Readonly<Record<OperacionTraspaso, Transicion>> = {
  // PULL: Origen aprueba una solicitud → el stock sale en ese momento.
  aprobar: {
    lado: "origen",
    desde: "SOLICITADA",
    hacia: "ENVIADA",
    mensajeLado: NO_ES_ORIGEN,
    mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede aprobar de nuevo.`,
  },
  // PULL: Origen rechaza una solicitud (nunca tocó stock).
  rechazar_solicitud: {
    lado: "origen",
    desde: "SOLICITADA",
    hacia: "RECHAZADA_ORIGEN",
    mensajeLado: NO_ES_ORIGEN,
    mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede rechazar desde acá.`,
  },
  // PULL: Destino (quien la pidió) cancela su propia solicitud (nunca tocó stock).
  cancelar_solicitud: {
    lado: "destino",
    desde: "SOLICITADA",
    hacia: "CANCELADA",
    mensajeLado: "Esta solicitud no la creó esta sucursal.",
    mensajeEstado: (e) => `Este traspaso ya está en estado "${e}" — no se puede cancelar desde acá.`,
  },
  // Destino acepta lo que está en tránsito → entra a su stock.
  aceptar: {
    lado: "destino",
    desde: "ENVIADA",
    hacia: "ACEPTADA",
    mensajeLado: NO_ES_DESTINO,
    mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no se puede aceptar.`,
  },
  // Destino rechaza lo que está en tránsito → queda pendiente el reingreso en Origen.
  rechazar_envio: {
    lado: "destino",
    desde: "ENVIADA",
    hacia: "RECHAZADA_DESTINO",
    mensajeLado: NO_ES_DESTINO,
    mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no se puede rechazar desde acá.`,
  },
  // Origen confirma el reingreso de un envío rechazado → vuelve a su stock.
  confirmar_reingreso: {
    lado: "origen",
    desde: "RECHAZADA_DESTINO",
    hacia: "CERRADA",
    mensajeLado: NO_ES_ORIGEN,
    mensajeEstado: (e) => `Este traspaso está en estado "${e}" — no hay ningún reingreso pendiente.`,
  },
};

/** Primero el lado (quién actúa), después el estado — el mismo orden en que lo chequeaban las Server Actions. */
export function guardTransicionTraspaso(traspaso: TraspasoParaGuard, operacion: OperacionTraspaso, sucursalId: string): ResultadoTransicionTraspaso {
  const t = TRANSICIONES_TRASPASO[operacion];
  const sucursalDelLado = t.lado === "origen" ? traspaso.origenSucursalId : traspaso.destinoSucursalId;
  if (sucursalDelLado !== sucursalId) return { ok: false, motivo: "LADO", mensaje: t.mensajeLado };
  if (traspaso.estado !== t.desde) return { ok: false, motivo: "ESTADO", mensaje: t.mensajeEstado(traspaso.estado) };
  return { ok: true, estadoNuevo: t.hacia };
}
