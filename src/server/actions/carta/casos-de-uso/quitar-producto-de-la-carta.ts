import "server-only";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoQuitarProductoDeLaCarta, ResultadoQuitarProductoDeLaCarta } from "@/core/features/carta/mantenimiento.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { borrarContenidoDeProducto } from "@/server/persistencia/carta/contenido-producto";

/**
 * Caso de uso «Quitar de la carta» (CARTA-MANT; ADR-034; decisión del dueño 2026-10-14): el producto vuelve a «Fuera de carta» (POS y menú del día) en la carta de la sucursal ACTIVA. Es el
 * «Deshacer» de «Agregar a la carta» y la salida de algo que no tiene que estar en la carta: ocultarlo lo dejaba «oculto» (con contenido) y un segundo «agregar» daba `YA_TIENE_CONTENIDO`.
 *
 * Se BORRA la fila de `ContenidoCartaProducto` de esta sucursal: ninguna tabla la referencia (ella referencia al producto, la sección y el género), así que no deja nada colgado; el producto, su
 * disponibilidad, su precio local, su descuento y su lugar en un ítem agrupado son OTRAS filas y no se tocan (un miembro de un agrupado sigue saliendo dentro de él: lo dice el mensaje). Lo que la
 * fila tenía queda en la auditoría, un registro por dato (`visibleEnCarta`, `seccionCartaId`, `orden` y, si estaban cargados, `descripcion`, `tags`, `especial` y `generoCartaId`, del valor a `null`).
 *
 * Dentro de UNA transacción SERIALIZABLE: lee el producto y su contenido en esta sucursal; sin contenido, éxito sin cambio (idempotente: quitar dos veces no hace nada); con algo cargado a mano
 * (descripción, tags, ★ o género) y sin `confirmado`, `HAY_DATOS_CARGADOS` sin borrar nada (la pantalla pregunta); si no, audita y borra. Agregar y quitar a la vez se ordenan (SERIALIZABLE aborta a
 * uno y su reintento relee); dos quitar a la vez dejan UNA sola tanda de auditoría.
 *
 * @contract Deja el producto sin contenido de carta en la sucursal activa (vuelve a «Fuera de carta»), con la auditoría de lo que tenía; si tenía datos cargados, solo con `confirmado`.
 * @idempotency Por estado — sin contenido no se escribe ni se audita: repetir el pedido no cambia nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE): la lectura que decide, la auditoría y el borrado, juntos.
 * @sideEffects registrarCambioAuditado (`ContenidoCartaProducto`, un registro por dato, con la sucursal), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action si cambió algo.
 * @ficha permiso=carta_contenido_producto transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarProductoDeLaCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion">,
  comando: ComandoQuitarProductoDeLaCarta,
): Promise<ResultadoQuitarProductoDeLaCarta> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoQuitarProductoDeLaCarta> => {
    const producto = await tx.producto.findUnique({
      where: { id: comando.productoId },
      select: {
        nombre: true,
        contenidosCarta: {
          where: whereCartaDeSucursal(actor.sucursalId),
          take: 1,
          select: { visibleEnCarta: true, seccionCartaId: true, orden: true, descripcion: true, tags: true, especial: true, generoCartaId: true, seccionCarta: { select: { nombre: true } } },
        },
        opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { nombre: true } } } },
      },
    });
    if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
    const c = producto.contenidosCarta[0];
    if (!c) return exito(`«${producto.nombre}» ya estaba fuera de la carta en «${actor.sucursalNombre}».`, { huboCambio: false });

    const cargado = [c.descripcion ? "la descripción" : null, c.tags.length ? "los tags" : null, c.especial ? "el ★ especial" : null, c.generoCartaId ? "el género" : null].filter((x): x is string => x !== null);
    if (cargado.length && !comando.confirmado) {
      return fracaso("HAY_DATOS_CARGADOS", `«${producto.nombre}» tiene cargado ${cargado.join(", ")}: al quitarlo de la carta se pierde. Confirmá para quitarlo igual.`);
    }

    const base = { entidad: "ContenidoCartaProducto" as const, entidadId: `${actor.sucursalId}:${comando.productoId}`, valorNuevo: null, actorId: actor.usuarioId, sucursalId: actor.sucursalId };
    const descripcion = `Carta de «${actor.sucursalNombre}»: «${producto.nombre}» quitado de la carta${c.seccionCarta ? ` (estaba en «${c.seccionCarta.nombre}»)` : ""}`;
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "visibleEnCarta", valorAnterior: c.visibleEnCarta });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "seccionCartaId", valorAnterior: c.seccionCartaId });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "orden", valorAnterior: c.orden });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "descripcion", valorAnterior: c.descripcion });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "tags", valorAnterior: c.tags.length ? c.tags.join(", ") : null });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "especial", valorAnterior: c.especial ? true : null });
    await registrarCambioAuditado(tx, { ...base, descripcion, campo: "generoCartaId", valorAnterior: c.generoCartaId });
    await borrarContenidoDeProducto(tx, { sucursalId: actor.sucursalId, productoId: comando.productoId });

    const agrupado = producto.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.nombre;
    return exito(
      agrupado
        ? `«${producto.nombre}» salió de la carta suelta; sigue saliendo dentro del agrupado «${agrupado}» (eso se maneja desde «Agrupados»).`
        : `«${producto.nombre}» volvió a «Fuera de carta» (POS y menú del día).`,
      { huboCambio: true },
    );
  }, undefined, undefined, true);
}
