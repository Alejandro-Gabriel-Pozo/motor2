import "server-only";
import { decidirIniciar, impideCerrar } from "@/core/caja/public";
import type { ComandoDeJornada, ResultadoIniciarAuditoria } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { leerControlesDeLaJornada } from "@/server/lecturas/caja/controles-de-la-jornada";
import { bloquearJornadaParaCambiar, iniciarAuditoriaEnBase } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «empezar el cierre del día» (etapa C2, CU8; Pedernal `cierre/casos-de-uso/iniciar-auditoria.ts`, decisiones 160, 167 y 168 y e3b §3.3): pasa la jornada de la sucursal activa de `ABIERTA` a `EN_AUDITORIA` («En cierre»). Mientras dura no se
 * abre caja ni se cobra.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden:
 *  1. la fecha es un día del calendario (`FECHA_INVALIDA`);
 *  2. toma la jornada con `FOR UPDATE` (quien tiene actividad en ella la toma con `FOR SHARE`: o la actividad entra antes y se ve como impedimento, o este caso espera y la actividad ve la jornada ya en cierre y no escribe); sin jornada → `JORNADA_NO_ENCONTRADA`
 *     (la jornada nace con la primera actividad del día);
 *  3. `CERRADA` → `JORNADA_CERRADA`; ya `EN_AUDITORIA` → `yaEstabaEnAuditoria: true` sin escribir ni auditar (doble clic o reintento);
 *  4. `ABIERTA` → lee lo que IMPIDE contar el día (los controles `BLOQUEA` con hallazgos: sesiones de caja sin cerrar y cuentas abiertas); con alguno → `JORNADA_CON_IMPEDIMENTOS { impedimentos }`; si no, pasa a `EN_AUDITORIA` y audita.
 * Segunda barrera: el disparador `JornadaDeSucursal_validar_cambio` (solo las tres transiciones permitidas).
 *
 * @contract Pasa la jornada a `EN_AUDITORIA` una sola vez y solo sin impedimentos, o no escribe nada.
 * @idempotency Por estado: repetirlo con la jornada ya en cierre devuelve `yaEstabaEnAuditoria` sin escribir; el `FOR UPDATE` serializa dos pedidos a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (estado de la jornada).
 * @ficha permiso=jornada_operar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function iniciarAuditoriaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoDeJornada,
): Promise<ResultadoIniciarAuditoria> {
  if (!esDiaISOReal(comando.fechaDeNegocio)) return fracaso("FECHA_INVALIDA", "La fecha del día de negocio no es válida.");

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoIniciarAuditoria> => {
      const jornada = await bloquearJornadaParaCambiar(tx, actor.empresaId, actor.sucursalId, comando.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "Ese día todavía no tiene actividad: no hay nada que cerrar.");
      const decision = decidirIniciar(jornada.estado as "ABIERTA" | "EN_AUDITORIA" | "CERRADA");
      if (!decision.ok) return fracaso(decision.error, "El día de negocio ya está cerrado.");
      if (decision.valor === "YA_ESTABA") return exito("El cierre del día ya estaba empezado.", { yaEstabaEnAuditoria: true });

      const { controles } = await leerControlesDeLaJornada(tx, { empresaId: actor.empresaId, sucursalId: actor.sucursalId, fechaDeNegocio: comando.fechaDeNegocio, jornadaId: jornada.id, zonaHoraria: actor.empresaZonaHoraria, ahora: actor.ahora, soloImpedimentos: true });
      const impedimentos = controles.filter(impideCerrar).map((c) => ({ clave: c.clave, cantidad: c.cantidad, referencias: c.referencias }));
      if (impedimentos.length > 0) return { ...fracaso("JORNADA_CON_IMPEDIMENTOS", "Hay cajas sin cerrar o cuentas abiertas: resolvelas antes de empezar el cierre."), impedimentos };

      await iniciarAuditoriaEnBase(tx, { empresaId: actor.empresaId, id: jornada.id, iniciadaEn: actor.ahora, iniciadaPorId: actor.usuarioId });
      await registrarCambioAuditado(tx, {
        entidad: "JornadaDeSucursal",
        entidadId: jornada.id,
        descripcion: `Cierre del día ${comando.fechaDeNegocio} empezado`,
        campo: "estado",
        valorAnterior: "ABIERTA",
        valorNuevo: "EN_AUDITORIA",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Cierre del día empezado.", { yaEstabaEnAuditoria: false });
    },
    undefined,
    undefined,
    true,
  );
}
