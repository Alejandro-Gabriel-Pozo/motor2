import "server-only";
import { decidirCancelar } from "@/core/caja/public";
import type { ComandoDeJornada, ResultadoCancelarAuditoria } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearJornadaParaCambiar, cancelarAuditoriaEnBase } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «cancelar el cierre del día» (etapa C2, CU8; Pedernal `cierre/casos-de-uso/cancelar-auditoria.ts`, e3b §3.3): devuelve la jornada de la sucursal activa de `EN_AUDITORIA` a `ABIERTA` para seguir cobrando. Lo que se haya registrado durante el
 * cierre (correcciones de medio, declaraciones de total, el conforme general) QUEDA (solo se agrega) y se cuenta en el cierre final; los reconocimientos de controles hay que volver a darlos (se piden al cerrar).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE: fecha válida (`FECHA_INVALIDA`); `FOR UPDATE` de la jornada (sin jornada → `JORNADA_NO_ENCONTRADA`); `CERRADA` →
 * `JORNADA_CERRADA`; ya `ABIERTA` → `yaEstabaAbierta: true` sin escribir ni auditar; `EN_AUDITORIA` → `ABIERTA` (borra las marcas de la auditoría) y audita. Segunda barrera: el disparador `JornadaDeSucursal_validar_cambio` y el CHECK de marcas.
 *
 * @contract Devuelve la jornada a `ABIERTA` una sola vez, o no escribe nada.
 * @idempotency Por estado: repetirlo con la jornada ya abierta devuelve `yaEstabaAbierta` sin escribir; el `FOR UPDATE` serializa dos pedidos a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (estado de la jornada).
 * @ficha permiso=caja_jornada_cancelar_auditoria transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cancelarAuditoriaCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">, comando: ComandoDeJornada): Promise<ResultadoCancelarAuditoria> {
  if (!esDiaISOReal(comando.fechaDeNegocio)) return fracaso("FECHA_INVALIDA", "La fecha del día de negocio no es válida.");

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCancelarAuditoria> => {
      const jornada = await bloquearJornadaParaCambiar(tx, actor.empresaId, actor.sucursalId, comando.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "Ese día todavía no tiene actividad.");
      const decision = decidirCancelar(jornada.estado as "ABIERTA" | "EN_AUDITORIA" | "CERRADA");
      if (!decision.ok) return fracaso(decision.error, "El día de negocio ya está cerrado.");
      if (decision.valor === "YA_ESTABA") return exito("El día ya estaba abierto.", { yaEstabaAbierta: true });

      await cancelarAuditoriaEnBase(tx, { empresaId: actor.empresaId, id: jornada.id });
      await registrarCambioAuditado(tx, {
        entidad: "JornadaDeSucursal",
        entidadId: jornada.id,
        descripcion: `Cierre del día ${comando.fechaDeNegocio} cancelado`,
        campo: "estado",
        valorAnterior: "EN_AUDITORIA",
        valorNuevo: "ABIERTA",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Cierre del día cancelado.", { yaEstabaAbierta: false });
    },
    undefined,
    undefined,
    true,
  );
}
