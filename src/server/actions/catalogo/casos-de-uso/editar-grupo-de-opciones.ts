import "server-only";
import { MENSAJE_GRUPO_NO_ENCONTRADO } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoEditarGrupoDeOpciones, ResultadoEditarGrupoDeOpciones } from "@/core/features/catalogo/opciones-de-venta.schema";
import { cambiosPorColumna, validarGrupo } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { actualizarGrupoDeOpciones } from "@/server/persistencia/catalogo/opciones-de-venta";
import {
  admisionesActivasDelGrupo,
  avisoDeProductosAfectados,
  cargarGrupoEnTx,
  grupoConElMismoNombre,
  opcionesActivasDelGrupo,
  productoConCantidadesIncoherentes,
  productosSinPoderVenderse,
} from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «editar un grupo de opciones de venta» (GO-2a): el nombre, las cantidades y si está activo, con la VERSIÓN que vio la pantalla. El tipo no se edita nunca.
 *
 * Todo dentro de UNA transacción SERIALIZABLE: relee el grupo (no está → `GRUPO_NO_ENCONTRADO`; otra versión → `VERSION_DESACTUALIZADA`), valida las cantidades según el tipo
 * (`validarGrupo`) y contra las que cada PRODUCTO puso sobre el grupo (las admisiones activas, leídas acá: un producto con mínimo propio 2 no puede quedar con un máximo efectivo de 1),
 * el nombre único sin distinguir mayúsculas, y recién entonces escribe con `version = esperada` en el `where` (defensa doble: si otra edición confirmó en el medio, 0 filas →
 * `VERSION_DESACTUALIZADA`). Sin cambios no escribe, no sube la versión y no audita. D-4: apagar un grupo obligatorio (o dejar un mínimo inalcanzable) no se bloquea; el mensaje
 * avisa a cuántos productos deja sin poder venderse.
 *
 * @contract Deja el grupo con el nombre, las cantidades y el estado pedidos, y su versión + 1 (o igual si no cambió nada).
 * @idempotency Optimista — `versionEsperada` se compara dentro de la transacción y en el `where` del UPDATE: con la versión vieja y otro cambio da `VERSION_DESACTUALIZADA`; si el grupo ya está como se pide (el mismo pedido repetido), éxito sin escribir ni auditar.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico` (un renombre simultáneo al mismo nombre choca con el único y el reintento lo rechaza).
 * @sideEffects registrarCambioAuditado (una fila por columna cambiada, con el antes y el después), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarGrupoDeOpcionesCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoEditarGrupoDeOpciones
): Promise<ResultadoEditarGrupoDeOpciones> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarGrupoDeOpciones> => {
      const grupo = await cargarGrupoEnTx(tx, comando.grupoId);
      if (!grupo) return fracaso("GRUPO_NO_ENCONTRADO", MENSAJE_GRUPO_NO_ENCONTRADO);
      const regla = validarGrupo({ tipo: grupo.tipo, cantidadMinima: comando.cantidadMinima, cantidadMaxima: comando.cantidadMaxima });
      if (!regla.ok) return fracaso("CONFIGURACION_INVALIDA", regla.mensaje);

      const cambios = cambiosPorColumna([
        { campo: "nombre", antes: grupo.nombre, despues: comando.nombre },
        { campo: "cantidadMinima", antes: grupo.cantidadMinima, despues: comando.cantidadMinima },
        { campo: "cantidadMaxima", antes: grupo.cantidadMaxima, despues: comando.cantidadMaxima },
        { campo: "activo", antes: grupo.activo, despues: comando.activo },
      ]);
      if (cambios.length === 0) return exito(`El grupo «${grupo.nombre}» no tenía cambios.`, { version: grupo.version, huboCambio: false, productosAfectados: 0 });
      if (grupo.version !== comando.versionEsperada) {
        return fracaso("VERSION_DESACTUALIZADA", `El grupo «${grupo.nombre}» cambió mientras lo editabas: otra persona lo guardó antes. Recargá la pantalla y volvé a hacer el cambio.`);
      }

      if (comando.nombre !== grupo.nombre) {
        const otro = await grupoConElMismoNombre(tx, comando.nombre, grupo.id);
        if (otro) return fracaso("NOMBRE_REPETIDO", `Ya hay un grupo llamado «${otro.nombre}». Elegí otro nombre.`);
      }

      const admisiones = await admisionesActivasDelGrupo(tx, grupo.id);
      const incoherente = productoConCantidadesIncoherentes(grupo.tipo, comando, admisiones);
      if (incoherente) {
        return fracaso("CONFIGURACION_INVALIDA", `Con estas cantidades, «${incoherente.nombre}» (que pone su propio mínimo o máximo para este grupo) quedaría mal configurado: ${incoherente.mensaje}`);
      }

      const tocadas = await actualizarGrupoDeOpciones(tx, { ...comando, id: grupo.id, ahora: actor.ahora });
      if (tocadas === 0) return fracaso("VERSION_DESACTUALIZADA", `El grupo «${grupo.nombre}» cambió mientras lo editabas. Recargá la pantalla y volvé a hacer el cambio.`);

      const descripcion = `Grupo de opciones «${comando.nombre}»: edición.`;
      for (const c of cambios) {
        await registrarCambioAuditado(tx, { entidad: "GrupoDeOpciones", entidadId: grupo.id, campo: c.campo, descripcion, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId, sucursalId: null });
      }

      const afectados = productosSinPoderVenderse({ tipo: grupo.tipo, ...comando }, admisiones, await opcionesActivasDelGrupo(tx, grupo.id));
      return exito(`Grupo «${comando.nombre}» guardado.${avisoDeProductosAfectados(afectados)}`, { version: grupo.version + 1, huboCambio: true, productosAfectados: afectados });
    },
    undefined,
    undefined,
    true
  );
}
