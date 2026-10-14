import "server-only";
import type { ComandoOrdenarSeccionesCarta, ResultadoOrdenarSeccionesCarta } from "@/core/features/carta/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { fijarOrdenDeSeccionCarta } from "@/server/persistencia/carta/secciones";

/**
 * Caso de uso «ordenar las secciones de la carta» (CARTA-MANT F3; ADR-034; el «Ordenar» del prototipo aprobado: se toca la sección y después dónde va). Las secciones son de la EMPRESA: el orden
 * nuevo rige en todas las sucursales y en la carta pública. Fija el orden de TODAS de una vez, para que nunca quede a medias: la posición en la lista (0, 1, 2…), la misma escala que usa el alta
 * de una sección (DA5: una nueva cae al final con `orden` = cuántas hay).
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. cada sección pedida es de la empresa (si no, `SECCION_NO_ENCONTRADA`: la RLS no deja ver las de otra);
 *  2. la lista es EXACTAMENTE la de la empresa (falta una: otra persona creó una mientras se ordenaba → `ORDEN_DESACTUALIZADO`);
 *  3. si el orden ya es el pedido, éxito sin escribir ni auditar (el segundo clic de un doble clic, o el reintento de un pedido que ya se aplicó);
 *  4. el orden de cada sección tiene que seguir siendo el que vio la pantalla (`ordenVisto`; si alguna cambió, `ORDEN_DESACTUALIZADO` y no se cambia ninguna);
 *  5. cada sección que cambia de lugar, con su auditoría (`SeccionCarta.orden`, del anterior al nuevo).
 *
 * @contract Deja las secciones de la empresa en el orden pedido (posición 0, 1, 2…), con una auditoría por sección que cambió de lugar, o no cambia ninguna.
 * @idempotency Por estado — si el orden ya es el pedido, éxito sin escribir; el orden visto de cada sección arbitra los pedidos cruzados.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, las escrituras y la auditoría, juntas; dos órdenes a la vez se serializan.
 * @sideEffects registrarCambioAuditado (SeccionCarta.orden de cada sección que cambia), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function ordenarSeccionesCartaCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion">, comando: ComandoOrdenarSeccionesCarta): Promise<ResultadoOrdenarSeccionesCarta> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoOrdenarSeccionesCarta> => {
    const actuales = await tx.seccionCarta.findMany({ select: { id: true, nombre: true, orden: true } });
    const porId = new Map(actuales.map((x) => [x.id, x]));
    if (comando.secciones.some((x) => !porId.has(x.seccionCartaId))) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró una de las secciones: recargá la pantalla.");
    const desactualizado = () => fracaso("ORDEN_DESACTUALIZADO" as const, "Las secciones cambiaron mientras las ordenabas (otra persona creó o movió una): no se cambió ninguna. Recargá la pantalla y volvé a ordenarlas.");
    if (actuales.length !== comando.secciones.length) return desactualizado();

    const cambian = comando.secciones.flatMap((pedido, orden) => {
      const actual = porId.get(pedido.seccionCartaId)!;
      return actual.orden === orden ? [] : [{ actual, orden }];
    });
    if (cambian.length === 0) return exito("El orden de las secciones ya era ese: no cambió nada.", { cambiadas: 0 });
    if (comando.secciones.some((pedido) => porId.get(pedido.seccionCartaId)!.orden !== pedido.ordenVisto)) return desactualizado();

    for (const c of cambian) {
      await fijarOrdenDeSeccionCarta(tx, { id: c.actual.id, orden: c.orden });
      await registrarCambioAuditado(tx, {
        entidad: "SeccionCarta",
        entidadId: c.actual.id,
        campo: "orden",
        descripcion: `Sección de carta «${c.actual.nombre}»: lugar ${c.orden + 1} (orden de las secciones de la empresa)`,
        valorAnterior: c.actual.orden,
        valorNuevo: c.orden,
        actorId: actor.usuarioId,
        sucursalId: null,
      });
    }
    return exito("Listo: las secciones quedaron en el orden nuevo, en todas las sucursales.", { cambiadas: cambian.length });
  });
}
