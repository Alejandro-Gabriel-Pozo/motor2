import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_TRASPASO_NO_ENCONTRADO } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoRechazarSolicitudTraspaso, ResultadoRechazarSolicitudTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirRechazoDeSolicitud } from "@/server/persistencia/traspasos/escribir-cierre-de-solicitud";

/**
 * Caso de uso «Origen rechaza una solicitud» (PULL; Task #41, Fase M11a — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la
 * orquestación que antes vivía en línea en la Server Action `rechazarSolicitudTransferencia` (src/server/actions/traspasos/traspasos.ts),
 * en el MISMO orden y con los MISMOS textos.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Sin permisos (los chequeó `conPermiso`), sin formato (lo validó
 * `guardComandoRechazarSolicitudTraspaso`, que también normaliza el motivo), sin I3 (no escribe ninguna Operación).
 *
 * Dentro de UNA transacción SERIALIZABLE: sin ella, un rechazo que leía SOLICITADA justo antes de que la aprobación hiciera commit de la
 * SALIDA + ENVIADA escribía RECHAZADA_ORIGEN encima — el stock quedaba afuera del origen y nadie lo podía reingresar (el reingreso exige
 * RECHAZADA_DESTINO): stock perdido en tránsito. Con SERIALIZABLE, el que pierde la carrera reintenta, ve el estado ya cambiado y falla
 * con el error de estado (test/auditoria/traspasos-en-transito.test.ts, «stock en tránsito»). La solicitud nunca tocó stock.
 *
 * @contract Origen rechaza una solicitud SOLICITADA — la solicitud nunca tocó stock.
 * @idempotency No aplica — sin Operación donde guardarla; el aislamiento SERIALIZABLE evita la carrera de "stock perdido en tránsito" (una aprobación concurrente que pisara el rechazo).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno — solo el cambio de estado del traspaso.
 * @ficha permiso=traspaso_rechazar_solicitud transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function rechazarSolicitudDeTraspasoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoRechazarSolicitudTraspaso
): Promise<ResultadoRechazarSolicitudTraspaso> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRechazarSolicitudTraspaso> => {
    const traspaso = await cargarTraspaso(tx, comando.traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "rechazar_solicitud", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);

    await escribirRechazoDeSolicitud(tx, {
      traspasoId: traspaso.id,
      estadoNuevo: transicion.estadoNuevo,
      usuarioId: actor.usuarioId,
      motivo: comando.motivo,
      ahora: actor.ahora,
    });

    return exito("Solicitud rechazada.", { traspasoId: traspaso.id, estadoNuevo: transicion.estadoNuevo });
  });
}
