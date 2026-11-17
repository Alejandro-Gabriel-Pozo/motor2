import "server-only";
import type { ComandoReordenarRenglonesDeSeccion, ResultadoReordenarRenglonesDeSeccion } from "@/core/features/carta/orden-de-renglones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { requierePermiso } from "@/server/acceso/gate";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { auditarOrdenDeItemAgrupadoEnCarta } from "./auditar-orden-de-item-agrupado-en-carta";
import { auditarOrdenDeProductoEnCarta } from "./auditar-orden-de-producto-en-carta";
import { leerRenglonesDeSeccion } from "@/server/lecturas/carta/orden-de-renglones";
import { existeRenglonEnLaSucursal, fijarOrdenDeRenglon, leerSeccionParaOrdenar } from "@/server/persistencia/carta/orden-de-renglones";

/**
 * Caso de uso «reordenar los renglones de una sección de la carta» (CU-O2 de `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md`, etapa O1; molde exacto: `ordenar-secciones-carta.ts`). Los renglones son los
 * productos visibles en la carta y los ítems agrupados activos de UNA sección en la sucursal ACTIVA (`actor.sucursalId`, nunca una que llegue por parámetro): comparten la misma escala de `orden`. Fija el orden de TODOS de una
 * vez, para que nunca quede a medias: la posición en la lista (0, 1, 2…), la misma escala que usa el alta (el renglón nuevo cae al final). ★ (`especial`) no se toca.
 *
 * Permiso: la acción pide `carta_contenido_producto`; si la lista incluye ítems agrupados se pide además `carta_items_agrupados` (mismo piso y misma semilla; se evalúa al guardar, antes de abrir la transacción).
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. la sección es de la empresa (si no, `SECCION_NO_ENCONTRADA`: la RLS no deja ver las de otra);
 *  2. cada renglón pedido existe en la carta de esta sucursal (si no, `RENGLON_NO_ENCONTRADO`: un id de otra sucursal u otra empresa da la MISMA respuesta que uno inexistente);
 *  3. la lista es EXACTAMENTE la de la sección (falta o sobra uno —se agregó, se ocultó o se movió uno mientras se ordenaba— → `ORDEN_DESACTUALIZADO`);
 *  4. si el orden ya es el pedido, éxito sin escribir ni auditar (el segundo clic de un doble clic, o el reintento de un pedido que ya se aplicó);
 *  5. el orden de cada renglón tiene que seguir siendo el que vio la pantalla (`ordenVisto`; si alguno cambió, `ORDEN_DESACTUALIZADO` y no se cambia ninguno);
 *  6. cada renglón que cambia de lugar, con su auditoría (`orden`, del anterior al nuevo).
 *
 * @contract Deja los renglones de la sección en la sucursal activa en el orden pedido (posición 0, 1, 2…), con una auditoría por renglón que cambió de lugar, o no cambia ninguno.
 * @idempotency Por estado — si el orden ya es el pedido, éxito sin escribir; el orden visto de cada renglón arbitra los pedidos cruzados.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, las escrituras y la auditoría, juntas; dos órdenes a la vez se serializan.
 * @sideEffects registrarCambioAuditado, por los pasos compartidos `auditar-orden-de-producto-en-carta.ts` y `auditar-orden-de-item-agrupado-en-carta.ts` (`ContenidoCartaProducto.orden` o `ItemAgrupadoCarta.orden` de cada renglón que cambia, con la sucursal), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=carta_contenido_producto transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function reordenarRenglonesDeSeccionCasoDeUso(
  actor: Pick<ContextoDeAccion, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoReordenarRenglonesDeSeccion,
): Promise<ResultadoReordenarRenglonesDeSeccion> {
  // La lista tiene que ser la de la sección: si incluye ítems agrupados, además hace falta poder editarlos. Se decide ANTES de abrir la transacción (como `guardar-promo-carta.ts`).
  if (comando.renglones.some((r) => r.tipo === "ITEM_AGRUPADO")) {
    const gate = await requierePermiso(actor.usuarioId, actor.sucursalId, "carta_items_agrupados", actor.db);
    if (!gate.ok) return fracaso("SIN_PERMISO", gate.mensaje);
  }
  const { sucursalId } = actor;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoReordenarRenglonesDeSeccion> => {
    const seccion = await leerSeccionParaOrdenar(tx, comando.seccionCartaId);
    if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta: recargá la pantalla.");

    const actuales = await leerRenglonesDeSeccion(tx, { sucursalId, seccionCartaId: seccion.id });
    const porClave = new Map(actuales.map((r) => [`${r.tipo}:${r.id}`, r]));
    const fueraDeLaSeccion = comando.renglones.filter((p) => !porClave.has(`${p.tipo}:${p.id}`));
    for (const p of fueraDeLaSeccion) {
      if (!(await existeRenglonEnLaSucursal(tx, { sucursalId, tipo: p.tipo, id: p.id }))) return fracaso("RENGLON_NO_ENCONTRADO", "No se encontró uno de los renglones: recargá la pantalla.");
    }
    const desactualizado = () => fracaso("ORDEN_DESACTUALIZADO" as const, "Los renglones de la sección cambiaron mientras los ordenabas (otra persona agregó, ocultó o movió uno): no se cambió ninguno. Recargá la pantalla y volvé a ordenarlos.");
    if (fueraDeLaSeccion.length > 0 || actuales.length !== comando.renglones.length) return desactualizado();

    const cambian = comando.renglones.flatMap((pedido, orden) => {
      const actual = porClave.get(`${pedido.tipo}:${pedido.id}`)!;
      return actual.orden === orden ? [] : [{ actual, orden }];
    });
    if (cambian.length === 0) return exito("El orden de los renglones ya era ese: no cambió nada.", { cambiados: 0 });
    if (comando.renglones.some((pedido) => porClave.get(`${pedido.tipo}:${pedido.id}`)!.orden !== pedido.ordenVisto)) return desactualizado();

    for (const c of cambian) {
      await fijarOrdenDeRenglon(tx, { sucursalId, tipo: c.actual.tipo, id: c.actual.id, orden: c.orden });
      const descripcion = `Sección «${seccion.nombre}», «${c.actual.nombre}»: lugar ${c.orden + 1}`;
      if (c.actual.tipo === "PRODUCTO") await auditarOrdenDeProductoEnCarta(tx, { sucursalId, productoId: c.actual.id, descripcion, anterior: c.actual.orden, nuevo: c.orden, actorId: actor.usuarioId });
      else await auditarOrdenDeItemAgrupadoEnCarta(tx, { sucursalId, itemId: c.actual.id, descripcion, anterior: c.actual.orden, nuevo: c.orden, actorId: actor.usuarioId });
    }
    return exito("Listo: los renglones quedaron en el orden nuevo.", { cambiados: cambian.length });
  });
}
