import "server-only";
import { textoDeCentavos } from "@/core/caja/public";
import type { ComandoMovimientoManual, ResultadoMovimientoManual } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarMedioEfectivo, cargarMovimientoDeClave, cargarSesion, insertarMovimiento, sumarMovimientosPorMedio } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «ingreso o egreso manual de efectivo» (etapa C1, CU4): plata que entra o sale del cajón sin ser un cobro (retirar para pagar algo, sumar cambio), con un motivo obligatorio. Solo en efectivo.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE:
 *  1. la clave de reintento: se mira ANTES que el estado; el mismo pedido devuelve el movimiento ya hecho (`yaExistia`, sin escribir ni auditar de nuevo); la misma clave con otro pedido → `CLAVE_REUTILIZADA`;
 *  2. la sesión es de la sucursal activa y está ABIERTA (`SESION_NO_ENCONTRADA` / `SESION_CERRADA`);
 *  3. inserta el movimiento (signo por sentido) y lo audita. Un egreso mayor al efectivo esperado se PERMITE: avisa (`superaElEfectivo`) y lo deja en la auditoría; nunca bloquea (igual que Pedernal, PROPUESTA).
 * Segunda barrera: la base rechaza un movimiento en una sesión cerrada o de otra sucursal, y el índice único de la clave.
 *
 * @contract Agrega exactamente un movimiento de efectivo por clave a una sesión abierta, o no escribe nada.
 * @idempotency Clave de reintento única por empresa; el pedido se compara campo por campo con el movimiento ya guardado; además el índice único.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el movimiento, con su motivo y el aviso si superó el efectivo).
 * @ficha permiso=caja_mover_efectivo transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function registrarMovimientoManualCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">,
  comando: ComandoMovimientoManual,
  azar: FuenteDeAzar,
): Promise<ResultadoMovimientoManual> {
  const clase = comando.sentido === "INGRESO" ? "INGRESO_MANUAL" : "EGRESO_MANUAL";
  const conSigno = comando.sentido === "INGRESO" ? comando.importeEnCentavos : -comando.importeEnCentavos;

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoMovimientoManual> => {
      const previo = await cargarMovimientoDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previo) {
        const mismoPedido = previo.sesionId === comando.sesionId && previo.clase === clase && previo.importeEnCentavos === conSigno && previo.motivo === comando.motivo && previo.creadoPorId === actor.usuarioId;
        if (!mismoPedido) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otro movimiento.");
        return exito("El movimiento ya estaba registrado.", { movimientoId: previo.id, yaExistia: true, superaElEfectivo: false });
      }

      const sesion = await cargarSesion(tx, actor.empresaId, comando.sesionId);
      if (!sesion || sesion.sucursalId !== actor.sucursalId) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");
      if (sesion.estado !== "ABIERTA") return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");

      const efectivo = await cargarMedioEfectivo(tx, actor.empresaId);
      if (!efectivo) throw new Error("registrarMovimientoManual: la sesión existe pero el medio efectivo no.");
      const esperado = (await sumarMovimientosPorMedio(tx, actor.empresaId, sesion.id)).get(efectivo.id) ?? BigInt(0);
      const superaElEfectivo = conSigno < BigInt(0) && esperado + conSigno < BigInt(0);

      const movimientoId = azar.uuid();
      await insertarMovimiento(tx, {
        id: movimientoId,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        sesionId: sesion.id,
        clase,
        medioDePagoId: efectivo.id,
        importeEnCentavos: conSigno,
        motivo: comando.motivo,
        anulaAId: null,
        claveIdempotencia: comando.claveIdempotencia,
        creadoPorId: actor.usuarioId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "MovimientoCaja",
        entidadId: movimientoId,
        descripcion: `${comando.sentido === "INGRESO" ? "Ingreso" : "Egreso"} manual de efectivo: ${comando.motivo}${superaElEfectivo ? " (superó el efectivo esperado)" : ""}`,
        campo: superaElEfectivo ? "egreso_supera_efectivo" : clase.toLowerCase(),
        valorAnterior: null,
        valorNuevo: textoDeCentavos(conSigno),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Movimiento registrado.", { movimientoId, yaExistia: false, superaElEfectivo });
    },
    undefined,
    undefined,
    true,
  );
}
