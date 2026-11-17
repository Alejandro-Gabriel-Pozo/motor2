import "server-only";
import { textoDeCentavos } from "@/core/caja/public";
import type { ComandoAnularMovimiento, ResultadoAnularMovimiento } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarMovimiento, cargarMovimientoDeClave, cargarSesion, insertarMovimiento } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «anular un movimiento manual de caja» (etapa C1, CU4, nivel 5 I-2): nada se borra; anular es agregar OTRO movimiento, espejo del que se anula, con motivo. Solo se anulan ingresos, egresos manuales y ajustes (C2; un cobro
 * nunca se anula desde la caja, I-9) y una sola vez, dentro de su misma sesión abierta.
 *
 * `puedeAnularAjenos` lo decide la Server Action con la acción `caja_anular_movimiento_ajeno`: sin ella solo se anula lo propio (igual que Pedernal, PROPUESTA).
 * En UNA transacción SERIALIZABLE: la clave se mira ANTES que el estado (mismo pedido → `yaExistia`); movimiento de la sucursal activa; clase anulable; sesión abierta; no anulado ya; inserta el espejo y audita.
 * Segunda barrera: el único `MovimientoCaja_anula_key` (una anulación por movimiento) y el disparador que exige el espejo exacto.
 *
 * @contract Agrega exactamente una anulación por movimiento y por clave, o no escribe nada.
 * @idempotency Clave de reintento única por empresa; mismo pedido → la anulación ya hecha; además el único por movimiento anulado.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (la anulación con su motivo).
 * @ficha permiso=caja_mover_efectivo transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularMovimientoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">,
  comando: ComandoAnularMovimiento,
  puedeAnularAjenos: boolean,
  azar: FuenteDeAzar,
): Promise<ResultadoAnularMovimiento> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAnularMovimiento> => {
      const previa = await cargarMovimientoDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previa) {
        if (previa.anulaAId !== comando.movimientoId || previa.motivo !== comando.motivo) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otra anulación.");
        return exito("La anulación ya estaba registrada.", { movimientoId: previa.id, yaExistia: true });
      }

      const original = await cargarMovimiento(tx, actor.empresaId, comando.movimientoId);
      if (!original || original.sucursalId !== actor.sucursalId) return fracaso("MOVIMIENTO_NO_ENCONTRADO", "No se encontró el movimiento.");
      if (original.clase !== "INGRESO_MANUAL" && original.clase !== "EGRESO_MANUAL" && original.clase !== "AJUSTE") return fracaso("MOVIMIENTO_NO_ANULABLE", "Este movimiento no se anula desde la caja.");
      if (original.creadoPorId !== actor.usuarioId && !puedeAnularAjenos) return fracaso("SIN_PERMISO_SOBRE_MOVIMIENTO_AJENO", "Solo podés anular tus propios movimientos.");

      const sesion = await cargarSesion(tx, actor.empresaId, original.sesionId);
      if (!sesion) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");
      if (sesion.estado !== "ABIERTA") return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");

      const yaAnulado = await tx.movimientoCaja.findFirst({ where: { empresaId: actor.empresaId, anulaAId: original.id }, select: { id: true } });
      if (yaAnulado) return fracaso("MOVIMIENTO_YA_ANULADO", "Ese movimiento ya fue anulado.");

      const id = azar.uuid();
      await insertarMovimiento(tx, {
        id,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        sesionId: original.sesionId,
        clase: "ANULACION",
        medioDePagoId: original.medioDePagoId,
        importeEnCentavos: -original.importeEnCentavos,
        motivo: comando.motivo,
        anulaAId: original.id,
        claveIdempotencia: comando.claveIdempotencia,
        creadoPorId: actor.usuarioId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "MovimientoCaja",
        entidadId: id,
        descripcion: `Anulación del movimiento ${original.id}: ${comando.motivo}`,
        campo: "anulacion",
        valorAnterior: textoDeCentavos(original.importeEnCentavos),
        valorNuevo: textoDeCentavos(-original.importeEnCentavos),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Movimiento anulado.", { movimientoId: id, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
