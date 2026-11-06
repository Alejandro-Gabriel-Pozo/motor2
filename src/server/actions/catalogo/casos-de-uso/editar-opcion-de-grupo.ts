import "server-only";
import { MENSAJE_OPCION_NO_ENCONTRADA } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoEditarOpcionDeGrupo, ResultadoEditarOpcionDeGrupo } from "@/core/features/catalogo/opciones-de-venta.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { actualizarOpcionDeGrupo } from "@/server/persistencia/catalogo/opciones-de-venta";
import { cargarOpcionEnTx, opcionConElMismoNombre } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «editar una opción de un grupo» (GO-2a): el nombre y, carta «B» E3, la descripción que lee solo la carta (ausente = queda; `null` = se vacía), con la VERSIÓN que vio la pantalla (el orden va por `reordenar-opciones-de-grupo.ts` y archivar o restaurar por `archivar-opciones.ts`: editar NO toca esas columnas). Nunca cambia el grupo, el producto ancla ni la
 * «ninguna» (la app no tiene UPDATE de esas columnas). Lo que cobra y consume la opción no se edita: se le agrega una versión (`agregar-version-de-opcion.ts`).
 *
 * Dentro de UNA transacción SERIALIZABLE: relee la opción (no está → `OPCION_NO_ENCONTRADA`; otra versión → `VERSION_DESACTUALIZADA`), el nombre único en el grupo sin distinguir
 * mayúsculas, y escribe con `version = esperada` en el `where`. Sin cambios no escribe ni audita. Como no apaga nada, no hay aviso de productos afectados (`productosAfectados` es siempre 0).
 *
 * @contract Deja la opción con el nombre pedido (el orden y el estado no cambian), y su versión + 1 (o igual si no cambió nada).
 * @idempotency Optimista — `versionEsperada` se compara dentro de la transacción y en el `where` del UPDATE: con la versión vieja y otro cambio da `VERSION_DESACTUALIZADA`; si la opción ya está como se pide (el mismo pedido repetido), éxito sin escribir ni auditar.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico` (dos renombres simultáneos al mismo nombre en el grupo chocan con el único; el reintento rechaza al perdedor).
 * @sideEffects registrarCambioAuditado (una fila por columna cambiada, con el antes y el después), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarOpcionDeGrupoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoEditarOpcionDeGrupo
): Promise<ResultadoEditarOpcionDeGrupo> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarOpcionDeGrupo> => {
      const opcion = await cargarOpcionEnTx(tx, comando.opcionId);
      if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", MENSAJE_OPCION_NO_ENCONTRADA);
      // Carta «B», E3: ausente = la descripción queda como está; `null` = se vacía (el mismo patrón que `prefijoEnCarta` del grupo).
      const descripcionEnCarta = comando.descripcionEnCarta === undefined ? opcion.descripcionEnCarta : comando.descripcionEnCarta;
      const cambios = cambiosPorColumna([
        { campo: "nombre", antes: opcion.nombre, despues: comando.nombre },
        { campo: "descripcionEnCarta", antes: opcion.descripcionEnCarta, despues: descripcionEnCarta },
      ]);
      if (cambios.length === 0) return exito(`La opción «${opcion.nombre}» no tenía cambios.`, { version: opcion.version, huboCambio: false, productosAfectados: 0 });
      if (opcion.version !== comando.versionEsperada) {
        return fracaso("VERSION_DESACTUALIZADA", `La opción «${opcion.nombre}» cambió mientras la editabas: otra persona la guardó antes. Recargá la pantalla y volvé a hacer el cambio.`);
      }

      if (comando.nombre !== opcion.nombre) {
        const otra = await opcionConElMismoNombre(tx, opcion.grupoId, comando.nombre, opcion.id);
        if (otra) return fracaso("NOMBRE_REPETIDO", `Ya hay una opción llamada «${otra.nombre}» en «${opcion.grupo.nombre}». Elegí otro nombre.`);
      }

      const tocadas = await actualizarOpcionDeGrupo(tx, { id: opcion.id, versionEsperada: comando.versionEsperada, nombre: comando.nombre, descripcionEnCarta, ahora: actor.ahora });
      if (tocadas === 0) return fracaso("VERSION_DESACTUALIZADA", `La opción «${opcion.nombre}» cambió mientras la editabas. Recargá la pantalla y volvé a hacer el cambio.`);

      const descripcion = `Opción «${comando.nombre}» de «${opcion.grupo.nombre}»: edición.`;
      for (const c of cambios) {
        await registrarCambioAuditado(tx, { entidad: "OpcionDeGrupo", entidadId: opcion.id, campo: c.campo, descripcion, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId, sucursalId: null });
      }

      return exito(`Opción «${comando.nombre}» guardada.`, { version: opcion.version + 1, huboCambio: true, productosAfectados: 0 });
    },
    undefined,
    undefined,
    true
  );
}
