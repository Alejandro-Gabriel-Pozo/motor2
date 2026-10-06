import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_SECCION_DESTINO_NO_PROPIA, MENSAJE_TRASPASO_NO_ENCONTRADO } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoAceptarTraspaso, ResultadoAceptarTraspaso } from "@/core/features/traspasos/traspaso.schema";
import {
  calcularPayloadHash,
  chequearIdempotencia,
  conTransaccionSerializable,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  obtenerSeccionPropia,
  registrarResultadoIdempotente,
} from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarSucursalDelTraspaso, cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirAceptacionDeTraspaso } from "@/server/persistencia/traspasos/escribir-entrada-de-traspaso";
import { verificarProductoTransferible } from "./producto-transferible";

/**
 * Caso de uso «Destino acepta un envío» (Task #41, Fase M11b — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que
 * antes vivía en línea en la Server Action `aceptarTransferencia` (src/server/actions/traspasos/traspasos.ts), en el MISMO orden y con
 * los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("traspaso_aceptar")`) ni valida formato (eso lo hizo `guardComandoAceptarTraspaso`, clave I3 incluida).
 *
 * Pasos, en el orden de siempre:
 *  1. (fuera de la transacción, como antes) la sección de destino tiene que ser de ESTA sucursal;
 *  2. dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *     a. hash I3 (tag "ACEPTAR_TRASPASO", payload `{ id, seccionDestinoId }` con la sección TAL CUAL llegó, solo si hay clave) y
 *        `chequearIdempotencia`: un reenvío exacto devuelve el mensaje ORIGINAL; la misma clave con otro payload es conflicto;
 *     b. carga del traspaso (persistencia) y guard de transición `aceptar` (lado Destino, desde ENVIADA);
 *     c. re-chequeo de que el producto siga siendo transferible en ESTA sucursal (el stock entra recién ahora: pudo cambiar desde el
 *        envío) — el paso compartido `producto-transferible.ts`;
 *     d. la sucursal de origen (para el detalle y el mensaje), y la escritura de la ENTRADA y del traspaso ACEPTADO (persistencia);
 *     e. el resultado para la idempotencia (`registrarResultadoIdempotente`, solo si hay clave) y el mensaje de éxito.
 *
 * @contract Destino acepta un envío ENVIADO, re-chequea que el producto siga siendo transferible y escribe la entrada de stock.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la escritura de la entrada de Kardex y el cambio de estado del traspaso — sin auditoría de permisos propia.
 * @ficha permiso=traspaso_aceptar transaccion=SERIALIZABLE idempotencia=I3 auditoria=DOCUMENTO_PROPIO reloj=NEW_DATE
 */
export async function aceptarTraspasoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion">,
  comando: ComandoAceptarTraspaso
): Promise<ResultadoAceptarTraspaso> {
  const { traspasoId, seccionDestinoId, claveIdempotencia } = comando;

  const seccionDestino = await obtenerSeccionPropia(seccionDestinoId, actor.sucursalId, actor.db);
  if (!seccionDestino) return fracaso("SECCION_NO_PROPIA", MENSAJE_SECCION_DESTINO_NO_PROPIA);

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAceptarTraspaso> => {
    const payloadHash = claveIdempotencia ? calcularPayloadHash("ACEPTAR_TRASPASO", actor.sucursalId, { id: traspasoId, seccionDestinoId }) : "";
    const chequeo = await chequearIdempotencia(tx, claveIdempotencia ?? undefined, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { traspasoId, operacionId: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const traspaso = await cargarTraspaso(tx, traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "aceptar", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);
    const resProducto = await verificarProductoTransferible(tx, traspaso.productoId, [{ sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre }]);
    if (!resProducto.ok) return fracaso("PRODUCTO_NO_TRANSFERIBLE", resProducto.mensaje);

    const origen = await cargarSucursalDelTraspaso(tx, traspaso.origenSucursalId);
    const { operacionId } = await escribirAceptacionDeTraspaso(tx, {
      traspasoId: traspaso.id,
      productoId: traspaso.productoId,
      sucursalId: actor.sucursalId,
      usuarioId: actor.usuarioId,
      seccionId: seccionDestino.id,
      cantidad: traspaso.cantidad,
      detalle: `Transferencia recibida de sucursal "${origen.nombre}".`,
      estadoNuevo: transicion.estadoNuevo,
      ahora: new Date(),
      idempotencia: claveIdempotencia ? { claveIdempotencia, payloadHash } : null,
    });

    const mensaje = `Recibido de "${origen.nombre}".`;
    if (claveIdempotencia) await registrarResultadoIdempotente(tx, operacionId, mensaje);
    return exito(mensaje, { traspasoId: traspaso.id, operacionId, repetida: false });
  });
}
