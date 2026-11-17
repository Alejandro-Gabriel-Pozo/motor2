import "server-only";
import type { ComandoQuitarProductoDeFamilia, ResultadoQuitarProductoDeFamilia } from "@/core/features/carta/familias.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearFamilia, leerFamiliaPorId, leerMiembroVigenteDeProducto, marcarMiembroQuitado } from "@/server/persistencia/carta/familias";

/**
 * Caso de uso «quitar un producto de una familia» (CU-F4 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, etapa F1). Quitar NO borra: escribe quién y cuándo (`quitadoPorId`, `quitadoEn`) y el producto deja de
 * ser miembro vigente; volver a agregarlo es una fila NUEVA. El producto no se toca (precio, receta y stock siguen siendo suyos) y, quitado, puede ir a un ítem agrupado.
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. la familia es de la empresa y se toma (`FOR UPDATE`; si no, `FAMILIA_NO_ENCONTRADA`); 2. si el producto no es miembro vigente de esta familia, éxito sin escribir ni auditar
 * (`yaEstaba`: el segundo clic de un doble clic, o el reintento de un pedido ya aplicado); 3. la versión de la familia que vio la pantalla tiene que seguir siendo la vigente (`VERSION_DESACTUALIZADA`, no se cambia nada);
 * 4. se marca como quitado; 5. la auditoría (`miembro`, de verdadero a falso), con el mismo `tx`. Quitar no renumera las posiciones (los huecos se permiten) ni sube la versión de la familia.
 *
 * @contract Deja al producto fuera de la familia (quién y cuándo, sin borrar nada) con su fila de auditoría: todo o nada.
 * @idempotency Por estado — si el producto ya no era miembro vigente no se escribe ni se audita; la versión de la familia arbitra el pedido de una pantalla vieja.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, la escritura y la auditoría, juntas; dos pedidos sobre la misma familia se serializan (`FOR UPDATE`).
 * @sideEffects registrarCambioAuditado (`MiembroDeFamilia`, `miembro`, sin sucursal: es de la empresa), con el mismo `tx`. Nada lee las familias todavía: no hay carta pública que revalidar.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarProductoDeFamiliaCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">,
  comando: ComandoQuitarProductoDeFamilia,
): Promise<ResultadoQuitarProductoDeFamilia> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoQuitarProductoDeFamilia> => {
    if (!(await bloquearFamilia(tx, comando.familiaId))) return fracaso("FAMILIA_NO_ENCONTRADA", "No se encontró la familia: recargá la pantalla.");
    const familia = await leerFamiliaPorId(tx, comando.familiaId);
    if (!familia) return fracaso("FAMILIA_NO_ENCONTRADA", "No se encontró la familia: recargá la pantalla.");

    const miembro = await leerMiembroVigenteDeProducto(tx, comando.productoId);
    if (!miembro || miembro.familiaId !== familia.id) return exito("El producto ya no estaba en la familia: no cambió nada.", { yaEstaba: true });
    if (familia.version !== comando.versionEsperada) return fracaso("VERSION_DESACTUALIZADA", "Otra persona cambió esta familia mientras la mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.");

    if (!(await marcarMiembroQuitado(tx, { id: miembro.id, actorId: actor.usuarioId, ahora: actor.ahora }))) return exito("El producto ya no estaba en la familia: no cambió nada.", { yaEstaba: true });
    await registrarCambioAuditado(tx, {
      entidad: "MiembroDeFamilia",
      entidadId: `${familia.id}:${comando.productoId}`,
      campo: "miembro",
      descripcion: `Familia de productos «${familia.nombre}»: se quitó un producto`,
      valorAnterior: true,
      valorNuevo: false,
      actorId: actor.usuarioId,
      sucursalId: null,
    });
    return exito("Producto quitado de la familia.", { yaEstaba: false });
  });
}
