import "server-only";
import { MODO_DE_ORDEN_POR_DEFECTO, modoVigente } from "@/core/carta/public";
import type { ComandoFijarModoDeOrdenDeSeccion, ResultadoFijarModoDeOrdenDeSeccion } from "@/core/features/carta/orden-de-renglones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { requierePermiso } from "@/server/acceso/gate";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarModoDeOrden, crearModoDeOrden, haySeccionConItemsAgrupados, leerModoDeOrden, leerSeccionParaOrdenar } from "@/server/persistencia/carta/orden-de-renglones";

/**
 * Caso de uso «fijar el modo de orden de una sección» (CU-O1 de `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md`, etapa O1): `ALFABETICO` o `A_MANO`, por ESTADO deseado, en la sucursal ACTIVA
 * (`actor.sucursalId`, nunca una que llegue por parámetro). SIN FILA = `A_MANO` (lo que la carta hace hoy): elegir `A_MANO` sin fila no escribe nada. Pasar a `ALFABETICO` no toca el `orden` de los renglones: se conserva y vuelve
 * al elegir `A_MANO`. El orden de los renglones lo cambia otro caso de uso (`reordenar-renglones-de-seccion.ts`).
 *
 * Permiso: la acción pide `carta_contenido_producto`; si la sección tiene ítems agrupados se pide además `carta_items_agrupados` (el modo también decide cómo salen ellos). Se decide antes de abrir la transacción.
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. la sección es de la empresa (`SECCION_NO_ENCONTRADA`); 2. si el modo ya es el pedido, éxito sin escribir ni auditar («ya estaba»); 3. la versión que vio la pantalla tiene que seguir
 * siendo la vigente (0 = no había fila; si otra persona lo cambió, `MODO_DESACTUALIZADO` y no se cambia nada); 4. se crea la fila (con el `modoId` que mandó el servidor: un reintento no crea dos, y la base tiene un único por
 * sucursal y sección) o se cambia con la versión esperada; 5. la auditoría (`modo`, del anterior —`A_MANO` si no había fila— al nuevo).
 *
 * @contract Deja la sección con el modo pedido en la sucursal activa, con su fila de auditoría si cambió: todo o nada.
 * @idempotency Por estado — si el modo vigente ya es el pedido no se escribe ni se audita; la versión vista arbitra dos cambios a la vez y el `modoId` es la clave del alta.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: la lectura del modo, la escritura y la auditoría, juntas; el choque del único (dos altas a la vez) se repite y ve la fila de la otra.
 * @sideEffects registrarCambioAuditado (`ModoDeOrdenDeSeccionCarta`, `modo`, con la sucursal), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=carta_contenido_producto transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarModoDeOrdenDeSeccionCasoDeUso(
  actor: Pick<ContextoDeAccion, "db" | "transaccion" | "usuarioId" | "sucursalId" | "ahora">,
  comando: ComandoFijarModoDeOrdenDeSeccion,
): Promise<ResultadoFijarModoDeOrdenDeSeccion> {
  const { sucursalId } = actor;
  if (await haySeccionConItemsAgrupados(actor.db, { sucursalId, seccionCartaId: comando.seccionCartaId })) {
    const gate = await requierePermiso(actor.usuarioId, sucursalId, "carta_items_agrupados", actor.db);
    if (!gate.ok) return fracaso("SIN_PERMISO", gate.mensaje);
  }
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoFijarModoDeOrdenDeSeccion> => {
      const seccion = await leerSeccionParaOrdenar(tx, comando.seccionCartaId);
      if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta: recargá la pantalla.");

      const fila = await leerModoDeOrden(tx, { sucursalId, seccionCartaId: seccion.id });
      const anterior = fila ? modoVigente(fila.modo) : MODO_DE_ORDEN_POR_DEFECTO;
      if (anterior === comando.modo) return exito("El modo de orden ya era ese: no cambió nada.", { cambio: false });
      const desactualizado = () => fracaso("MODO_DESACTUALIZADO" as const, "Otra persona cambió el modo de orden de esta sección mientras la mirabas: no se cambió nada. Recargá la pantalla y volvé a elegir.");
      if ((fila?.version ?? 0) !== comando.versionVista) return desactualizado();

      if (fila) {
        if (!(await cambiarModoDeOrden(tx, { id: fila.id, versionEsperada: fila.version, modo: comando.modo, actorId: actor.usuarioId, ahora: actor.ahora }))) return desactualizado();
      } else {
        await crearModoDeOrden(tx, { id: comando.modoId, sucursalId, seccionCartaId: seccion.id, modo: comando.modo, actorId: actor.usuarioId, ahora: actor.ahora });
      }
      await registrarCambioAuditado(tx, {
        entidad: "ModoDeOrdenDeSeccionCarta",
        entidadId: `${sucursalId}:${seccion.id}`,
        campo: "modo",
        descripcion: `Sección de carta «${seccion.nombre}»: orden de los renglones ${comando.modo === "ALFABETICO" ? "alfabético" : "a mano"}`,
        valorAnterior: anterior,
        valorNuevo: comando.modo,
        actorId: actor.usuarioId,
        sucursalId,
      });
      return exito("Listo: cambió el modo de orden de la sección.", { cambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
