import "server-only";
import type { ComandoCambiarEstadoDeParte, ResultadoEstadoDeParte } from "@/core/features/partes/partes.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarEstadoDeParte, cargarParte } from "@/server/persistencia/partes/partes";

/**
 * Caso de uso «desactivar o reactivar una ficha de parte» (docs/diseno-parte-2026-11-12.md §3.3, comando CU3). Una ficha nunca se borra: inactiva deja de ofrecerse en operaciones NUEVAS; lo ya hecho no cambia (no toca
 * vínculos, roles ni operaciones existentes).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `partes_desactivar` (solo administrador o gerente, como Pedernal: D10).
 *
 * Pasos, dentro de UNA transacción SERIALIZABLE: lee la ficha (no existe → `PARTE_NO_ENCONTRADA`); si ya está en ese estado → éxito con `yaEstaba: true`, sin escribir ni auditar (repetir no hace nada); si no,
 * `UPDATE … WHERE estado = <el que leyó>` (dos desactivaciones a la vez: una sola escribe) y una fila de auditoría con el estado anterior y el nuevo (el estado no es un dato personal).
 *
 * @contract Deja la ficha en el estado pedido y lo audita una sola vez, o no cambia nada.
 * @idempotency Por estado: ya inactiva (o ya activa) → `yaEstaba`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (el cambio de estado).
 * @ficha permiso=partes_desactivar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cambiarEstadoDeParteCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion">, comando: ComandoCambiarEstadoDeParte): Promise<ResultadoEstadoDeParte> {
  const destino = comando.activa ? "ACTIVA" : "INACTIVA";
  const origen = comando.activa ? "INACTIVA" : "ACTIVA";
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoEstadoDeParte> => {
    const actual = await cargarParte(tx, actor.empresaId, comando.parteId);
    if (!actual) return fracaso("PARTE_NO_ENCONTRADA", "No se encontró esa ficha.");
    if (actual.estado === destino) return exito("Sin cambios.", { parteId: actual.id, activa: comando.activa, yaEstaba: true });
    const escribio = await cambiarEstadoDeParte(tx, { empresaId: actor.empresaId, id: actual.id, de: origen, a: destino });
    if (!escribio) return exito("Sin cambios.", { parteId: actual.id, activa: comando.activa, yaEstaba: true });
    await registrarCambioAuditado(tx, {
      entidad: "Parte",
      entidadId: actual.id,
      descripcion: comando.activa ? "Ficha de parte reactivada" : "Ficha de parte desactivada",
      campo: "estado",
      valorAnterior: origen,
      valorNuevo: destino,
      actorId: actor.usuarioId,
      sucursalId: null,
    });
    return exito(comando.activa ? "Ficha reactivada." : "Ficha desactivada.", { parteId: actual.id, activa: comando.activa, yaEstaba: false });
  });
}
