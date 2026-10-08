import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { validarCantidad } from "@/core/datos/cantidad";
import { MENSAJE_SECCION_ORIGEN_NO_PROPIA, MENSAJE_SUCURSAL_NO_DISPONIBLE } from "@/core/features/traspasos/traspaso-comandos.guard";
import type { ComandoCrearEnvioDirectoTraspaso, ResultadoCrearEnvioDirectoTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { calcularSaldoTotal, obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarSucursalParaTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirEnvioDirectoDeTraspaso } from "@/server/persistencia/traspasos/escribir-creacion-de-traspaso";
import { verificarProductoTransferible } from "./producto-transferible";

/**
 * Caso de uso «Origen envía directo» (PUSH; Task #41, Fase M11c — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación
 * que antes vivía en línea en la Server Action `crearEnvioDirectoTransferencia` (src/server/actions/traspasos/traspasos.ts), en el MISMO
 * orden y con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → id/nombre).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("traspaso_enviar_directo")`) ni valida formato (eso lo hizo `guardComandoCrearEnvioDirectoTraspaso`).
 *
 * Sin idempotencia I3, igual que antes (decisión de la M11c, ver el documento de la Fase M): el envío directo quedó fuera del alcance de
 * la política I3 (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md), su contrato devuelve `id`/`nombre`, que `resultadoMensaje`
 * no alcanza a reconstruir en un reenvío, y el formulario ya deshabilita el botón mientras la acción corre. Un envío duplicado nunca
 * deja el stock inconsistente: la SALIDA y el traspaso ENVIADO se escriben juntos, y el duplicado se deshace con el ciclo normal
 * (Destino lo rechaza y Origen confirma el reingreso).
 *
 * Pasos, en el orden de siempre, dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto
 * de escritura). Antes, las validaciones (y un primer chequeo de stock) corrían FUERA de la transacción y el stock se volvía a leer
 * adentro; ahora todo se lee adentro una sola vez, con el mismo texto de «Stock insuficiente».
 *  1. (sin base) la sucursal a la que se le manda no puede ser ESTA;
 *  2. existe y está activa;
 *  3. la sección de origen es de ESTA sucursal;
 *  4. el producto es transferible en origen Y destino (el paso compartido `producto-transferible.ts`);
 *  5. la cantidad, contra los decimales de la unidad de stock, ANTES del stock (así el error nombra la cantidad tecleada, no un «stock
 *     insuficiente» contra un valor que se iba a redondear);
 *  6. el stock disponible en la sección de origen;
 *  7. escritura del traspaso ENVIADO y de su SALIDA (persistencia) y el mensaje de éxito.
 *
 * @contract Origen envía directo (PUSH) a otra sucursal, escribiendo la SALIDA y el traspaso ENVIADO juntos en un solo paso.
 * @idempotency No aplica, decisión explícita (M11c) — fuera del alcance de I3 desde la auditoría original; un duplicado nunca deja el stock inconsistente (se deshace con el ciclo normal de rechazo+reingreso).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la escritura conjunta de la salida de Kardex y la creación del traspaso.
 * @ficha permiso=traspaso_enviar_directo transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearEnvioDirectoDeTraspasoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  comando: ComandoCrearEnvioDirectoTraspaso
): Promise<ResultadoCrearEnvioDirectoTraspaso> {
  if (comando.destinoSucursalId === actor.sucursalId) return fracaso("MISMA_SUCURSAL", "No podés mandarte una transferencia a vos mismo.");

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCrearEnvioDirectoTraspaso> => {
    const destino = await cargarSucursalParaTraspaso(tx, comando.destinoSucursalId);
    if (!destino || !destino.activo) return fracaso("SUCURSAL_NO_DISPONIBLE", MENSAJE_SUCURSAL_NO_DISPONIBLE);

    const seccionOrigen = await obtenerSeccionPropia(comando.seccionOrigenId, actor.sucursalId, tx);
    if (!seccionOrigen) return fracaso("SECCION_NO_PROPIA", MENSAJE_SECCION_ORIGEN_NO_PROPIA);

    const resProducto = await verificarProductoTransferible(tx, comando.productoId, [
      { sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre },
      { sucursalId: destino.id, sucursalNombre: destino.nombre },
    ]);
    if (!resProducto.ok) return fracaso("PRODUCTO_NO_TRANSFERIBLE", resProducto.mensaje);
    const producto = resProducto.producto;

    const resCantidad = validarCantidad(comando.cantidad, producto.unidadStock, { etiqueta: `La cantidad de "${producto.nombre}"`, obligatorio: true });
    if (!resCantidad.ok) return fracaso("CANTIDAD_INVALIDA", resCantidad.mensaje);
    const cantidad = resCantidad.valor!;

    const disponible = await calcularSaldoTotal(producto.id, seccionOrigen.id, tx);
    if (disponible < cantidad) {
      return fracaso(
        "STOCK_INSUFICIENTE",
        `Stock insuficiente de "${producto.nombre}" en "${seccionOrigen.nombre}". Actual: ${disponible}, requerido: ${cantidad}.`
      );
    }

    const { traspasoId, operacionId } = await escribirEnvioDirectoDeTraspaso(tx, {
      origenSucursalId: actor.sucursalId,
      destinoSucursalId: destino.id,
      productoId: producto.id,
      cantidad,
      seccionOrigenId: seccionOrigen.id,
      usuarioId: actor.usuarioId,
      detalle: comando.detalle,
      detalleSalida: `Transferencia a sucursal "${destino.nombre}".`,
      ahora: actor.ahora,
    });

    // Auditoría (decisión del dueño, 2026-10-07): el alta del envío directo (la cantidad enviada) deja su fila, en la sucursal de origen, que es quien lo manda.
    await registrarCambioAuditado(tx, {
      entidad: "TraspasoSucursal",
      entidadId: traspasoId,
      campo: "cantidad",
      descripcion: `Envío directo de "${producto.nombre}" desde "${actor.sucursalNombre}" hacia "${destino.nombre}"`,
      valorAnterior: null,
      valorNuevo: cantidad,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(
      `Enviado a "${destino.nombre}". Se descontó ${cantidad} ${producto.unidadStock.nombre} de "${producto.nombre}" en "${seccionOrigen.nombre}".`,
      { traspasoId, productoNombre: producto.nombre, operacionId, seccionOrigenId: seccionOrigen.id, cantidad }
    );
  });
}
