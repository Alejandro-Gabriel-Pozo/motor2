import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_TRASPASO_NO_ENCONTRADO } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoRechazarEnvioTraspaso, ResultadoRechazarEnvioTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirRechazoDeEnvio } from "@/server/persistencia/traspasos/escribir-rechazo-de-envio";

/**
 * Caso de uso «Destino rechaza un envío» (Task #41, Fase M11b — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación
 * que antes vivía en línea en la Server Action `rechazarTransferencia` (src/server/actions/traspasos/traspasos.ts), en el MISMO orden y
 * con los MISMOS textos.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Sin permisos (los chequeó `conPermiso`), sin formato (lo validó
 * `guardComandoRechazarEnvioTraspaso`, que también normaliza el motivo). Sin I3: no crea ninguna Operación donde guardarla
 * (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §6.2).
 *
 * Todavía NO toca stock: el reingreso lo confirma Origen aparte. Lectura + guard + escritura dentro de UNA transacción SERIALIZABLE: dos
 * rechazos simultáneos con motivo distinto ya no responden los DOS ok (el segundo pisaba el motivo del primero en silencio, §6.3) — el
 * que pierde reintenta, ve el estado ya cambiado y falla con el error de estado (test/auditoria/traspasos-en-transito.test.ts).
 *
 * @contract Destino rechaza un envío ENVIADO — todavía no toca stock, el reingreso lo confirma Origen después.
 * @idempotency No aplica — sin Operación donde guardarla; el aislamiento SERIALIZABLE evita que dos rechazos concurrentes con motivo distinto se pisen en silencio.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno — solo el cambio de estado del traspaso (motivo incluido).
 */
export async function rechazarEnvioDeTraspasoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoRechazarEnvioTraspaso
): Promise<ResultadoRechazarEnvioTraspaso> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRechazarEnvioTraspaso> => {
    const traspaso = await cargarTraspaso(tx, comando.traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "rechazar_envio", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);

    await escribirRechazoDeEnvio(tx, {
      traspasoId: traspaso.id,
      estadoNuevo: transicion.estadoNuevo,
      usuarioId: actor.usuarioId,
      motivo: comando.motivo,
      ahora: new Date(),
    });

    return exito("Transferencia rechazada — queda pendiente que el origen confirme el reingreso a su stock.", {
      traspasoId: traspaso.id,
      estadoNuevo: transicion.estadoNuevo,
    });
  });
}
