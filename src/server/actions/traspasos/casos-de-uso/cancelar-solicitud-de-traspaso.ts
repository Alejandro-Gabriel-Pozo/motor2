import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_TRASPASO_NO_ENCONTRADO } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoCancelarSolicitudTraspaso, ResultadoCancelarSolicitudTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirCancelacionDeSolicitud } from "@/server/persistencia/traspasos/escribir-cierre-de-solicitud";

/**
 * Caso de uso «Destino cancela su propia solicitud» (PULL; Task #41, Fase M11a — ver docs/arquitectura-casos-de-uso-2026-09-27.md).
 * Es la orquestación que antes vivía en línea en la Server Action `cancelarSolicitudTransferencia`
 * (src/server/actions/traspasos/traspasos.ts), en el MISMO orden y con los MISMOS textos.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Sin permisos (los chequeó `conPermiso`), sin formato (lo validó
 * `guardComandoCancelarSolicitudTraspaso`), sin I3 (no escribe ninguna Operación donde guardarla).
 *
 * Lectura + guard + escritura dentro de UNA transacción SERIALIZABLE (docs/plan-mutaciones-controladas-2026-09-25.md, Paso 4): dos
 * cancelaciones simultáneas no pueden responder las dos «cancelada», y una cancelación que leyó SOLICITADA justo antes de que Origen
 * aprobara no la pisa — la que pierde reintenta, ve el estado ya cambiado y falla con el error de estado. Una solicitud nunca tocó
 * stock, así que no hay reingreso: solo se cierra el traspaso.
 *
 * @contract Destino cancela su propia solicitud SOLICITADA — nunca tocó stock, así que solo cierra el traspaso.
 * @idempotency No aplica — sin Operación donde guardar una clave; el aislamiento SERIALIZABLE arbitra la carrera de estado.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno — solo el cambio de estado del traspaso (nunca tocó Kardex).
 * @ficha permiso=traspaso_cancelar_solicitud transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function cancelarSolicitudDeTraspasoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoCancelarSolicitudTraspaso
): Promise<ResultadoCancelarSolicitudTraspaso> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCancelarSolicitudTraspaso> => {
    const traspaso = await cargarTraspaso(tx, comando.traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "cancelar_solicitud", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);

    await escribirCancelacionDeSolicitud(tx, { traspasoId: traspaso.id, estadoNuevo: transicion.estadoNuevo, usuarioId: actor.usuarioId, ahora: actor.ahora });

    return exito("Solicitud cancelada.", { traspasoId: traspaso.id, estadoNuevo: transicion.estadoNuevo });
  });
}
