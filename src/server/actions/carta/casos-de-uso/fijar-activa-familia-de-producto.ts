import "server-only";
import type { ComandoFijarActivaFamiliaDeProducto, ResultadoFijarActivaFamiliaDeProducto } from "@/core/features/carta/familias.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearFamilia, cambiarFamilia, leerFamiliaPorId } from "@/server/persistencia/carta/familias";

const MENSAJE_FAMILIA_NO_ENCONTRADA = "No se encontró la familia: recargá la pantalla.";

/**
 * Caso de uso «desactivar o reactivar una familia de productos» (CU-F5 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, etapa F1), por ESTADO deseado. Nunca se borra una familia: desactivada, sus miembros SIGUEN
 * siéndolo (decisión de Pedernal, fila 231: «Sí, siguen siendo miembros») y la carta deja de agruparla (etapa F4).
 *
 * Dentro de UNA transacción SERIALIZABLE: 1. la familia es de la empresa y se toma (`FOR UPDATE`; si no, `FAMILIA_NO_ENCONTRADA`); 2. si ya está en ese estado, éxito sin escribir ni auditar (`yaEstaba`); 3. la versión que vio
 * la pantalla tiene que seguir siendo la vigente (`VERSION_DESACTUALIZADA`, no se cambia nada); 4. se cambia con la versión esperada; 5. la auditoría (`activa`), con el mismo `tx`.
 *
 * @contract Deja la familia activa o desactivada, con la versión subida en uno y su fila de auditoría: todo o nada.
 * @idempotency Por estado y versión — si la familia ya está en ese estado no se escribe ni se audita; la versión vista arbitra dos cambios a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE): la lectura que decide, la escritura y la auditoría, juntas; dos cambios a la vez se serializan.
 * @sideEffects registrarCambioAuditado (`FamiliaDeProducto`, `activa`, sin sucursal: es de la empresa), con el mismo `tx`. Nada lee las familias todavía: no hay carta pública que revalidar.
 * @ficha permiso=carta_secciones transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarActivaFamiliaDeProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "ahora">,
  comando: ComandoFijarActivaFamiliaDeProducto,
): Promise<ResultadoFijarActivaFamiliaDeProducto> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoFijarActivaFamiliaDeProducto> => {
    if (!(await bloquearFamilia(tx, comando.familiaId))) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);
    const familia = await leerFamiliaPorId(tx, comando.familiaId);
    if (!familia) return fracaso("FAMILIA_NO_ENCONTRADA", MENSAJE_FAMILIA_NO_ENCONTRADA);
    if (familia.activa === comando.activa) return exito(`La familia ya estaba ${comando.activa ? "activa" : "desactivada"}: no cambió nada.`, { yaEstaba: true });
    const desactualizada = () => fracaso("VERSION_DESACTUALIZADA" as const, "Otra persona cambió esta familia mientras la mirabas: no se cambió nada. Recargá la pantalla y volvé a intentar.");
    if (familia.version !== comando.versionEsperada) return desactualizada();
    if (!(await cambiarFamilia(tx, { id: familia.id, versionEsperada: familia.version, datos: { activa: comando.activa }, ahora: actor.ahora }))) return desactualizada();
    await registrarCambioAuditado(tx, {
      entidad: "FamiliaDeProducto",
      entidadId: familia.id,
      campo: "activa",
      descripcion: `Familia de productos «${familia.nombre}»: ${comando.activa ? "reactivada" : "desactivada"}`,
      valorAnterior: familia.activa,
      valorNuevo: comando.activa,
      actorId: actor.usuarioId,
      sucursalId: null,
    });
    return exito(`Familia "${familia.nombre}" ${comando.activa ? "reactivada" : "desactivada"}.`, { yaEstaba: false });
  });
}
