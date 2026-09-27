import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarCantidad } from "@/core/datos/cantidad";
import { MENSAJE_SECCION_DESTINO_SOLICITUD_NO_PROPIA, MENSAJE_SUCURSAL_NO_DISPONIBLE } from "@/core/features/traspasos/traspaso-comandos.guard";
import type { ComandoCrearSolicitudTraspaso, ResultadoCrearSolicitudTraspaso } from "@/core/features/traspasos/traspaso.schema";
import { conTransaccionSerializable, obtenerSeccionPropia } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarSucursalParaTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";
import { escribirSolicitudDeTraspaso } from "@/server/persistencia/traspasos/escribir-creacion-de-traspaso";
import { verificarProductoTransferible } from "./producto-transferible";

/**
 * Caso de uso «Destino pide una transferencia» (PULL; Task #41, Fase M11c — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la
 * orquestación que antes vivía en línea en la Server Action `crearSolicitudTransferencia` (src/server/actions/traspasos/traspasos.ts),
 * en el MISMO orden y con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → id/nombre).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("proceso_transferencia_sucursal")`) ni valida formato (eso lo hizo `guardComandoCrearSolicitudTraspaso`). Sin idempotencia
 * I3 (nunca la tuvo): no toca stock — queda SOLICITADA, pendiente de que Origen decida — y un duplicado por doble clic se cancela desde
 * la Bandeja (`cancelarSolicitudTransferencia`) sin ningún efecto sobre el Kardex.
 *
 * Pasos, en el orden de siempre, ahora dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`; antes eran lecturas sueltas
 * más un `create` sin transacción — mismo resultado, pero las lecturas y la escritura ven la misma foto):
 *  1. (sin base) la sucursal a la que se le pide no puede ser ESTA;
 *  2. existe y está activa;
 *  3. la sección de destino es de ESTA sucursal;
 *  4. el producto es transferible en origen Y destino (el paso compartido `producto-transferible.ts`);
 *  5. la cantidad, contra los decimales de la unidad de stock del producto: se RECHAZA el exceso, no se redondea
 *     (docs/plan-validacion-de-datos-2026-09-25.md);
 *  6. escritura del traspaso SOLICITADO (persistencia) y el mensaje de éxito.
 */
export async function crearSolicitudDeTraspasoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoCrearSolicitudTraspaso
): Promise<ResultadoCrearSolicitudTraspaso> {
  if (comando.origenSucursalId === actor.sucursalId) return fracaso("MISMA_SUCURSAL", "No podés pedirte una transferencia a vos mismo.");

  return conTransaccionSerializable(async (tx): Promise<ResultadoCrearSolicitudTraspaso> => {
    const origen = await cargarSucursalParaTraspaso(tx, comando.origenSucursalId);
    if (!origen || !origen.activo) return fracaso("SUCURSAL_NO_DISPONIBLE", MENSAJE_SUCURSAL_NO_DISPONIBLE);

    const seccionDestino = await obtenerSeccionPropia(comando.seccionDestinoId, actor.sucursalId, tx);
    if (!seccionDestino) return fracaso("SECCION_NO_PROPIA", MENSAJE_SECCION_DESTINO_SOLICITUD_NO_PROPIA);

    const resProducto = await verificarProductoTransferible(tx, comando.productoId, [
      { sucursalId: origen.id, sucursalNombre: origen.nombre },
      { sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre },
    ]);
    if (!resProducto.ok) return fracaso("PRODUCTO_NO_TRANSFERIBLE", resProducto.mensaje);
    const producto = resProducto.producto;

    const resCantidad = validarCantidad(comando.cantidad, producto.unidadStock, { etiqueta: `La cantidad de "${producto.nombre}"`, obligatorio: true });
    if (!resCantidad.ok) return fracaso("CANTIDAD_INVALIDA", resCantidad.mensaje);
    const cantidad = resCantidad.valor!;

    const { traspasoId } = await escribirSolicitudDeTraspaso(tx, {
      origenSucursalId: origen.id,
      destinoSucursalId: actor.sucursalId,
      productoId: producto.id,
      cantidad,
      seccionDestinoId: seccionDestino.id,
      usuarioId: actor.usuarioId,
      detalle: comando.detalle,
    });

    return exito(`Solicitud enviada a "${origen.nombre}".`, { traspasoId, productoNombre: producto.nombre });
  });
}
