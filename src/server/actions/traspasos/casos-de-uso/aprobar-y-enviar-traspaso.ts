import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_SECCION_ORIGEN_NO_PROPIA, MENSAJE_SUCURSAL_NO_DISPONIBLE, MENSAJE_TRASPASO_NO_ENCONTRADO, mensajeSucursalPropiaInactivaParaEnviar } from "@/core/features/traspasos/traspaso-comandos.guard";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import type { ComandoAprobarYEnviarTraspaso, ResultadoAprobarYEnviarTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { calcularSaldoTotal, obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarSucursalParaTraspaso, cargarTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirAprobacionDeTraspaso } from "@/server/persistencia/traspasos/escribir-aprobacion-de-traspaso";
import { verificarProductoTransferible } from "./producto-transferible";

/**
 * Caso de uso «Origen aprueba una solicitud y envía» (PULL; Task #41, Fase M11a — ver docs/arquitectura-casos-de-uso-2026-09-27.md).
 * Es la orquestación que antes vivía en línea en la Server Action `aprobarYEnviarTransferencia`
 * (src/server/actions/traspasos/traspasos.ts), en el MISMO orden y con los MISMOS textos; la Server Action quedó como adaptador fino
 * (permiso → guard → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("traspaso_aprobar")`) ni valida formato (eso lo hizo `guardComandoAprobarYEnviarTraspaso`). Sin idempotencia
 * I3: la aprobación nunca la tuvo (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §11.5) — un doble clic lo arbitra el
 * aislamiento SERIALIZABLE, y el segundo intento responde «ya está en estado ENVIADA».
 *
 * Pasos, en el orden de siempre:
 *  1. (fuera de la transacción, como antes) la sección de origen tiene que ser de ESTA sucursal;
 *  2. dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *     a. carga del traspaso (persistencia) y guard de transición `aprobar` (lado Origen, desde SOLICITADA);
 *     b. P15: ESTA sucursal (la que envía) y la de destino siguen activas —se leen con el `tx`: pudieron apagarse desde la solicitud, y una SOLICITADA pendiente NO impide apagar una sucursal—, y el re-chequeo de que el
 *        producto siga siendo transferible en origen Y destino (pudo cambiar desde la solicitud: el stock sale recién ahora). Las dos lecturas pegan con el apagado simultáneo (lee los traspasos ENVIADA y escribe
 *        `Sucursal.activo`; esto lee `activo` y escribe un ENVIADA): Postgres ve el ciclo y aborta una; el reintento da el rechazo de negocio;
 *     c. el stock disponible en la sección de origen, leído DENTRO de la transacción;
 *     d. escritura de la SALIDA y del traspaso ENVIADO (persistencia);
 *     e. el mensaje de éxito.
 *
 * @contract Origen aprueba una solicitud SOLICITADA y envía, re-chequeando que las dos sucursales sigan activas, la transferibilidad y el stock disponible leído DENTRO de la transacción.
 * @idempotency No aplica (nunca la tuvo) — el aislamiento SERIALIZABLE arbitra el doble clic, el segundo intento ve el estado ya ENVIADA.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la escritura de la salida de Kardex y el cambio de estado del traspaso.
 * @ficha permiso=traspaso_aprobar transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function aprobarYEnviarTraspasoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "ahora">,
  comando: ComandoAprobarYEnviarTraspaso
): Promise<ResultadoAprobarYEnviarTraspaso> {
  const seccionOrigen = await obtenerSeccionPropia(comando.seccionOrigenId, actor.sucursalId, actor.db);
  if (!seccionOrigen) return fracaso("SECCION_NO_PROPIA", MENSAJE_SECCION_ORIGEN_NO_PROPIA);

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAprobarYEnviarTraspaso> => {
    const traspaso = await cargarTraspaso(tx, comando.traspasoId);
    if (!traspaso) return fracaso("NO_ENCONTRADO", MENSAJE_TRASPASO_NO_ENCONTRADO);
    const transicion = guardTransicionTraspaso(traspaso, "aprobar", actor.sucursalId);
    if (!transicion.ok) return fracaso(transicion.motivo, transicion.mensaje);

    const propia = await cargarSucursalParaTraspaso(tx, actor.sucursalId);
    if (!propia || !propia.activo) return fracaso("SUCURSAL_INACTIVA", mensajeSucursalPropiaInactivaParaEnviar(propia?.nombre ?? actor.sucursalNombre));
    const destino = await cargarSucursalParaTraspaso(tx, traspaso.destinoSucursalId);
    if (!destino || !destino.activo) return fracaso("SUCURSAL_NO_DISPONIBLE", MENSAJE_SUCURSAL_NO_DISPONIBLE);
    const resProducto = await verificarProductoTransferible(tx, traspaso.productoId, [
      { sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre },
      { sucursalId: destino.id, sucursalNombre: destino.nombre },
    ]);
    if (!resProducto.ok) return fracaso("PRODUCTO_NO_TRANSFERIBLE", resProducto.mensaje);

    const cantidad = traspaso.cantidad;
    const disponible = await calcularSaldoTotal(traspaso.productoId, seccionOrigen.id, actor.sucursalId, tx);
    if (disponible < cantidad) {
      return fracaso(
        "STOCK_INSUFICIENTE",
        `Stock insuficiente de "${traspaso.productoNombre}" en "${seccionOrigen.nombre}". Actual: ${disponible}, requerido: ${cantidad}.`
      );
    }

    const { operacionId } = await escribirAprobacionDeTraspaso(tx, {
      traspasoId: traspaso.id,
      productoId: traspaso.productoId,
      sucursalId: actor.sucursalId,
      usuarioId: actor.usuarioId,
      seccionOrigenId: seccionOrigen.id,
      cantidad,
      detalle: `Transferencia a sucursal "${destino.nombre}".`,
      estadoNuevo: transicion.estadoNuevo,
      ahora: actor.ahora,
    });

    return exito(`Aprobado y enviado a "${destino.nombre}".`, { traspasoId: traspaso.id, operacionId, seccionOrigenId: seccionOrigen.id, cantidad });
  });
}
