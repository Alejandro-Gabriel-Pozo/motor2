import "server-only";
import { decidirCambioDeEstado } from "@/core/caja/public";
import type { ComandoCambiarEstadoDeMedioDePago, ResultadoDesactivarMedioDePago, ResultadoReactivarMedioDePago } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarActivoDeMedio, cargarMedio } from "@/server/persistencia/caja/configuracion";

type Actor = Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora">;

/** Lo común de desactivar y reactivar: cambia `activo` y audita, o dice que ya estaba como se pide (por estado: no escribe ni audita). El efectivo no se desactiva nunca. */
async function cambiarEstado(actor: Actor, comando: ComandoCambiarEstadoDeMedioDePago, seQuiereActivo: boolean) {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx) => {
      const actual = await cargarMedio(tx, actor.empresaId, comando.medioDePagoId);
      if (!actual) return fracaso("MEDIO_NO_ENCONTRADO", "No se encontró el medio de pago.");
      if (!seQuiereActivo && actual.tipo === "EFECTIVO") return fracaso("EFECTIVO_NO_SE_DESACTIVA", "El efectivo no se desactiva: siempre se puede cobrar en efectivo.");
      if (decidirCambioDeEstado(actual.activo, seQuiereActivo) === "YA_ESTABA") return { yaEstaba: true as const };
      if (!(await cambiarActivoDeMedio(tx, { empresaId: actor.empresaId, id: actual.id, versionEsperada: actual.version, ahora: actor.ahora, activo: seQuiereActivo }))) return fracaso("MEDIO_NO_ENCONTRADO", "No se encontró el medio de pago.");
      await registrarCambioAuditado(tx, {
        entidad: "MedioDePago",
        entidadId: actual.id,
        descripcion: `Medio de pago ${actual.nombre ?? actual.tipo}: ${seQuiereActivo ? "reactivado" : "desactivado"}`,
        campo: "activo",
        valorAnterior: !seQuiereActivo,
        valorNuevo: seQuiereActivo,
        actorId: actor.usuarioId,
        sucursalId: null,
      });
      return { yaEstaba: false as const };
    },
    undefined,
    undefined,
    true,
  );
}

/**
 * Caso de uso «desactivar un medio de pago» (etapa C3; Pedernal `desactivarMedioDePago`). Ya inactivo → `yaEstabaInactivo` sin escribir ni auditar. El EFECTIVO no se desactiva nunca (`EFECTIVO_NO_SE_DESACTIVA`; la base
 * también lo impide): siempre se puede cobrar en efectivo. Lo ya cobrado no se toca. `import "server-only"` y SIN `"use server"`.
 *
 * @contract Deja el medio inactivo (o ya lo estaba); el efectivo queda siempre activo.
 * @idempotency Por estado: repetirlo devuelve `yaEstabaInactivo` sin escribir ni auditar de nuevo.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cambio de estado).
 * @ficha permiso=medios_de_pago_desactivar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function desactivarMedioDePagoCasoDeUso(actor: Actor, comando: ComandoCambiarEstadoDeMedioDePago): Promise<ResultadoDesactivarMedioDePago> {
  const r = await cambiarEstado(actor, comando, false);
  if ("ok" in r) return r;
  return exito(r.yaEstaba ? "El medio de pago ya estaba desactivado." : "Medio de pago desactivado.", { yaEstabaInactivo: r.yaEstaba });
}

/**
 * Caso de uso «reactivar un medio de pago» (etapa C3; Pedernal `reactivarMedioDePago`): lo mismo, hacia activo. Ya activo → `yaEstabaActivo`. `import "server-only"` y SIN `"use server"`.
 *
 * @contract Deja el medio activo (o ya lo estaba).
 * @idempotency Por estado: repetirlo devuelve `yaEstabaActivo` sin escribir ni auditar de nuevo.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cambio de estado).
 * @ficha permiso=medios_de_pago_reactivar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function reactivarMedioDePagoCasoDeUso(actor: Actor, comando: ComandoCambiarEstadoDeMedioDePago): Promise<ResultadoReactivarMedioDePago> {
  const r = await cambiarEstado(actor, comando, true);
  if ("ok" in r) return r as ResultadoReactivarMedioDePago;
  return exito(r.yaEstaba ? "El medio de pago ya estaba activo." : "Medio de pago reactivado.", { yaEstabaActivo: r.yaEstaba });
}
