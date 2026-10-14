import "server-only";
import { ordenAlFinalDeLaSeccion, whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoAgregarProductoALaCarta, ResultadoAgregarProductoALaCarta } from "@/core/features/carta/mantenimiento.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearContenidoVisibleDeProducto } from "@/server/persistencia/carta/contenido-producto";

/**
 * Caso de uso «agregar a la carta» un producto que estaba FUERA de carta (CARTA-MANT; ADR-034): lo publica de un toque en la sección elegida, visible y AL FINAL de ella, en la
 * carta de la sucursal ACTIVA (escribe SOLO en `actor.sucursalId`; el guard ya comparó el eco de la pantalla y las políticas por sucursal son la segunda barrera). La descripción, los tags, el ★ y el
 * género quedan vacíos: se completan después en su ficha.
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. el producto: existe (la RLS oculta el de otra empresa), es de venta, no es el ancla de un adicional (que se vende solo como adicional, nunca suelto en la carta) y no está dentro de un
 *     ítem agrupado de esta sucursal (D3: ahí ya sale; suelto quedaría duplicado y no se mostraría, `ES_MIEMBRO_DE_AGRUPADO`);
 *  2. su contenido en esta sucursal: si ya existe visible en ESA sección, no se escribe ni se audita (repetir no duplica); si existe de otra forma (otra sección u oculto), `YA_TIENE_CONTENIDO`: no se
 *     pisa lo que alguien cargó;
 *  3. la sección: existe y está activa (en una apagada no saldría);
 *  4. el orden: uno más que el mayor de la sección EN ESTA SUCURSAL (productos e ítems agrupados comparten la escala), `ordenAlFinalDeLaSeccion`;
 *  5. `create` del contenido (nunca `upsert`) y su fila de auditoría (`ContenidoCartaProducto`, `visibleEnCarta`, de `null` a `true`, con la sucursal), en la misma transacción.
 * Dos «agregar» a la vez del mismo producto: el único `(sucursalId, productoId)` hace chocar al segundo (o SERIALIZABLE lo aborta) y su reintento relee: misma sección → éxito sin cambio; otra →
 * `YA_TIENE_CONTENIDO`. Queda UNA fila y UNA auditoría.
 *
 * @contract Deja el producto visible en la carta de la sucursal activa, en la sección pedida y al final, con su auditoría, si estaba fuera de carta; si no, no escribe nada.
 * @idempotency Por estado — si ya está visible en esa sección no se escribe ni se audita; dos pedidos a la vez dejan UNA fila (el único y el reintento).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`ContenidoCartaProducto`, `visibleEnCarta`, con la sucursal), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action si cambió algo.
 * @ficha permiso=carta_contenido_producto transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarProductoALaCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion">,
  comando: ComandoAgregarProductoALaCarta,
): Promise<ResultadoAgregarProductoALaCarta> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAgregarProductoALaCarta> => {
      const producto = await tx.producto.findUnique({
        where: { id: comando.productoId },
        select: {
          nombre: true,
          tipo: true,
          opcionQueRespalda: { select: { id: true } },
          contenidosCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { visibleEnCarta: true, seccionCartaId: true } },
          opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { nombre: true } } } },
        },
      });
      if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
      if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
      if (producto.opcionQueRespalda) return fracaso("ES_ANCLA_DE_ADICIONAL", `«${producto.nombre}» es el producto de respaldo de un adicional: se vende solo como adicional, no va suelto en la carta.`);

      // D3: un PV agrupado sale en la carta SOLO dentro de su ítem agrupado; suelto no se mostraría y quedaría duplicado. Se saca o se suma desde «Agrupados».
      const agrupado = producto.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.nombre;
      if (agrupado) return fracaso("ES_MIEMBRO_DE_AGRUPADO", `«${producto.nombre}» ya sale en la carta dentro del agrupado «${agrupado}»: se maneja desde «Agrupados».`);

      const seccion = await tx.seccionCarta.findUnique({ where: { id: comando.seccionCartaId }, select: { id: true, nombre: true, activa: true } });
      if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");

      const existente = producto.contenidosCarta[0];
      if (existente) {
        if (existente.visibleEnCarta && existente.seccionCartaId === seccion.id) return exito(`«${producto.nombre}» ya estaba en la carta, en «${seccion.nombre}».`, { huboCambio: false });
        return fracaso("YA_TIENE_CONTENIDO", `«${producto.nombre}» ya tiene contenido de carta en «${actor.sucursalNombre}»: mostralo o cambiale la sección desde su ficha.`);
      }
      if (!seccion.activa) return fracaso("SECCION_APAGADA", `La sección «${seccion.nombre}» está apagada: no saldría en la carta. Prendela o elegí otra.`);

      const [contenidos, agrupados] = await Promise.all([
        tx.contenidoCartaProducto.findMany({ where: { ...whereCartaDeSucursal(actor.sucursalId), seccionCartaId: seccion.id }, select: { orden: true } }),
        tx.itemAgrupadoCarta.findMany({ where: { ...whereCartaDeSucursal(actor.sucursalId), seccionCartaId: seccion.id }, select: { orden: true } }),
      ]);
      const orden = ordenAlFinalDeLaSeccion([...contenidos, ...agrupados].map((f) => f.orden));
      await crearContenidoVisibleDeProducto(tx, { sucursalId: actor.sucursalId, productoId: comando.productoId, seccionCartaId: seccion.id, orden });
      await registrarCambioAuditado(tx, {
        entidad: "ContenidoCartaProducto",
        entidadId: `${actor.sucursalId}:${comando.productoId}`,
        campo: "visibleEnCarta",
        descripcion: `Carta de «${actor.sucursalNombre}»: «${producto.nombre}» agregado a «${seccion.nombre}»`,
        valorAnterior: null,
        valorNuevo: true,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito(`«${producto.nombre}» ya sale en la carta, al final de «${seccion.nombre}».`, { huboCambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
