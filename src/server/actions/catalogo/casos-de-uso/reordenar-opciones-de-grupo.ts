import "server-only";
import { MENSAJE_GRUPO_NO_ENCONTRADO } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoReordenarOpcionesDeGrupo, ResultadoReordenarOpcionesDeGrupo } from "@/core/features/catalogo/opciones-de-venta.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { actualizarOpcionDeGrupo } from "@/server/persistencia/catalogo/opciones-de-venta";
import { cargarGrupoEnTx } from "./opciones-de-venta-en-tx";

/** Paso entre un orden y el siguiente: deja lugar para que un alta caiga entre dos opciones sin renumerar las demás. */
const PASO_DE_ORDEN = 10;

/**
 * Caso de uso «ordenar las opciones de un grupo» (GO-2d, el «mover tocando» de la pantalla del grupo): fija el orden de TODAS las opciones del grupo de una sola vez, en una
 * transacción, para que el orden nunca quede a medias. El orden nuevo es la posición en la lista (10, 20, 30…); solo se escriben las opciones cuyo orden cambia, cada una con su
 * versión esperada y con su auditoría por columna (`orden`), igual que `editar-opcion-de-grupo.ts`. El nombre y el estado de cada opción no se tocan.
 *
 * Dentro de UNA transacción SERIALIZABLE: relee el grupo (no está → `GRUPO_NO_ENCONTRADO`) y sus opciones. La lista tiene que ser EXACTAMENTE la del grupo (una opción que falta o
 * que sobra es una pantalla vieja → `VERSION_DESACTUALIZADA`) y, de las que cambian de lugar, la versión tiene que ser la que vio la pantalla (se compara ANTES de la primera
 * escritura). Si el orden ya es el pedido, éxito sin escribir ni auditar (el segundo clic de un doble clic).
 *
 * @contract Deja las opciones del grupo en el orden pedido (posición × 10) y la versión + 1 de cada opción que cambió de lugar.
 * @idempotency Optimista — la versión de cada opción que cambia se compara dentro de la transacción y en el `where` del UPDATE; si el orden ya es el pedido, éxito sin escribir.
 * @transaction conTransaccionSerializable (SERIALIZABLE): dos órdenes a la vez sobre el mismo grupo se serializan y el segundo ve versiones nuevas.
 * @sideEffects registrarCambioAuditado (una fila por opción que cambió de lugar, campo `orden`), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function reordenarOpcionesDeGrupoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoReordenarOpcionesDeGrupo
): Promise<ResultadoReordenarOpcionesDeGrupo> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoReordenarOpcionesDeGrupo> => {
    const grupo = await cargarGrupoEnTx(tx, comando.grupoId);
    if (!grupo) return fracaso("GRUPO_NO_ENCONTRADO", MENSAJE_GRUPO_NO_ENCONTRADO);
    const desactualizado = () => fracaso("VERSION_DESACTUALIZADA" as const, `Las opciones de «${grupo.nombre}» cambiaron mientras las ordenabas. Recargá la pantalla y volvé a ordenarlas.`);

    const actuales = await tx.opcionDeGrupo.findMany({ where: { grupoId: grupo.id }, select: { id: true, nombre: true, orden: true, activa: true, version: true } });
    const porId = new Map(actuales.map((o) => [o.id, o]));
    if (actuales.length !== comando.opciones.length || comando.opciones.some((o) => !porId.has(o.opcionId))) return desactualizado();

    const cambian = comando.opciones.flatMap((pedido, i) => {
      const actual = porId.get(pedido.opcionId)!;
      const orden = (i + 1) * PASO_DE_ORDEN;
      return actual.orden === orden ? [] : [{ actual, orden, versionEsperada: pedido.versionEsperada }];
    });
    if (cambian.length === 0) return exito(`El orden de «${grupo.nombre}» no tenía cambios.`, { huboCambio: false });
    if (cambian.some((c) => c.actual.version !== c.versionEsperada)) return desactualizado();

    for (const c of cambian) {
      const tocadas = await actualizarOpcionDeGrupo(tx, { id: c.actual.id, versionEsperada: c.versionEsperada, nombre: c.actual.nombre, orden: c.orden, activa: c.actual.activa, ahora: actor.ahora });
      if (tocadas === 0) return desactualizado();
      await registrarCambioAuditado(tx, {
        entidad: "OpcionDeGrupo",
        entidadId: c.actual.id,
        campo: "orden",
        descripcion: `Opción «${c.actual.nombre}» de «${grupo.nombre}»: orden nuevo.`,
        valorAnterior: c.actual.orden,
        valorNuevo: c.orden,
        actorId: actor.usuarioId,
        sucursalId: null,
      });
    }
    return exito(`Listo: «${grupo.nombre}» quedó con el orden nuevo.`, { huboCambio: true });
  });
}
