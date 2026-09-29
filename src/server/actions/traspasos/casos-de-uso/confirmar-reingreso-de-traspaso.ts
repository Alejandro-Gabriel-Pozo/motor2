import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_SIN_SECCION_ORIGEN, MENSAJE_TRASPASO_NO_ENCONTRADO } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoConfirmarReingresoTraspaso, ResultadoConfirmarReingresoTraspaso } from "@/core/features/traspasos/traspaso.schema";
import {
  calcularPayloadHash,
  chequearIdempotencia,
  conTransaccionSerializable,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  registrarResultadoIdempotente,
} from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarSeccionDelTraspaso, cargarSucursalDelTraspaso, cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirReingresoDeTraspaso } from "@/server/persistencia/traspasos/escribir-entrada-de-traspaso";

/**
 * Caso de uso «Origen confirma el reingreso tras un rechazo de Destino» (Task #41, Fase M11b — ver
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes vivía en línea en la Server Action
 * `confirmarReingresoTransferencia` (src/server/actions/traspasos/traspasos.ts), en el MISMO orden y con los MISMOS textos.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Sin permisos (los chequeó `conPermiso`), sin formato (lo validó
 * `guardComandoConfirmarReingresoTraspaso`, clave I3 incluida). No re-chequea la disponibilidad del producto (nunca lo hizo): el stock
 * vuelve a la sección de la que salió.
 *
 * Todo dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`):
 *  1. hash I3 (tag "REINGRESO_TRASPASO", payload `{ id }`, solo si hay clave) y `chequearIdempotencia`;
 *  2. carga del traspaso (persistencia), guard de transición `confirmar_reingreso` (lado Origen, desde RECHAZADA_DESTINO) y la sección
 *     de origen registrada (sin ella no hay dónde reingresar);
 *  3. la sucursal destino (para el detalle) y la sección de origen (para el mensaje);
 *  4. escritura del REINGRESO y del traspaso CERRADO (persistencia);
 *  5. el resultado para la idempotencia (`registrarResultadoIdempotente`, solo si hay clave) y el mensaje de éxito.
 *
 * @contract Origen confirma el reingreso de un traspaso RECHAZADA_DESTINO, devolviendo el stock a la sección de la que salió.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la escritura del reingreso de Kardex y el cierre del traspaso.
 */
export async function confirmarReingresoDeTraspasoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoConfirmarReingresoTraspaso
): Promise<ResultadoConfirmarReingresoTraspaso> {
  const { traspasoId, claveIdempotencia } = comando;

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConfirmarReingresoTraspaso> => {
    const payloadHash = claveIdempotencia ? calcularPayloadHash("REINGRESO_TRASPASO", actor.sucursalId, { id: traspasoId }) : "";
    const chequeo = await chequearIdempotencia(tx, claveIdempotencia ?? undefined, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { traspasoId, operacionId: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const traspaso = await cargarTraspaso(tx, traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "confirmar_reingreso", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);
    if (!traspaso.seccionOrigenId) return fracaso("SIN_SECCION_ORIGEN", MENSAJE_SIN_SECCION_ORIGEN);

    const cantidad = traspaso.cantidad;
    const destino = await cargarSucursalDelTraspaso(tx, traspaso.destinoSucursalId);
    const seccionOrigen = await cargarSeccionDelTraspaso(tx, traspaso.seccionOrigenId);
    const { operacionId } = await escribirReingresoDeTraspaso(tx, {
      traspasoId: traspaso.id,
      productoId: traspaso.productoId,
      sucursalId: actor.sucursalId,
      usuarioId: actor.usuarioId,
      seccionId: traspaso.seccionOrigenId,
      cantidad,
      detalle: `Reingreso — rechazado por sucursal "${destino.nombre}".`,
      estadoNuevo: transicion.estadoNuevo,
      ahora: new Date(),
      idempotencia: claveIdempotencia ? { claveIdempotencia, payloadHash } : null,
    });

    const mensaje = `Reingreso confirmado: se sumó de nuevo ${cantidad} de "${traspaso.productoNombre}" en "${seccionOrigen.nombre}".`;
    if (claveIdempotencia) await registrarResultadoIdempotente(tx, operacionId, mensaje);
    return exito(mensaje, { traspasoId: traspaso.id, operacionId, repetida: false });
  });
}
