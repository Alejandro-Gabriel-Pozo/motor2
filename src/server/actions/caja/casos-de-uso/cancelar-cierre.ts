import "server-only";
import { decidirCancelarCierre, estadoDeSesion } from "@/core/caja/public";
import type { ComandoCancelarCierre, ResultadoCancelarCierre } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cancelarCierreEnBase, cargarSesion } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «cancelar el cierre de la sesión de caja» (etapa C1b, docs/diseno-caja-c1b-en-cierre-2026-11-16.md): la sesión vuelve de EN_CIERRE a ABIERTA, sin las marcas del cierre, y los cobros y movimientos vuelven a entrar.
 * Volver atrás desde la pantalla de contar NO cancela el cierre (decisión 0455 de Pedernal): la caja sigue en cierre hasta que alguien lo cancele con este caso de uso o la cierre.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE:
 *  1. la sesión es de la sucursal activa (`SESION_NO_ENCONTRADA`);
 *  2. por estado: EN_CIERRE → vuelve a ABIERTA y audita; ya ABIERTA → `yaEstabaAbierta` sin escribir ni auditar; CERRADA → `SESION_CERRADA` (una cerrada no se reabre).
 * Segunda barrera: el disparador de la base deja pasar solo las transiciones del ciclo y el CHECK de marcas exige que la sesión vuelva sin cierre iniciado.
 *
 * @contract Deja la sesión ABIERTA y sin las marcas del cierre, una sola vez, o no escribe nada.
 * @idempotency Por estado: repetir con la sesión ya abierta devuelve `yaEstabaAbierta` sin escribir ni auditar; dos cancelaciones a la vez dejan una sola (la transacción serializable arbitra y el reintento ve el estado nuevo).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (la cancelación del cierre).
 * @ficha permiso=caja_cerrar_sesion transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=NO_APLICA periodo=NO_APLICA
 */
export async function cancelarCierreDeSesion(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">,
  comando: ComandoCancelarCierre,
): Promise<ResultadoCancelarCierre> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCancelarCierre> => {
      const sesion = await cargarSesion(tx, actor.empresaId, comando.sesionId);
      if (!sesion || sesion.sucursalId !== actor.sucursalId) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");

      const decision = decidirCancelarCierre(estadoDeSesion(sesion.estado));
      if (decision === "SESION_CERRADA") return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");
      if (decision === "YA_ESTABA") return exito("La caja ya estaba abierta.", { sesionId: sesion.id, yaEstabaAbierta: true });

      const escribio = await cancelarCierreEnBase(tx, { empresaId: actor.empresaId, id: sesion.id });
      if (!escribio) throw new Error("cancelarCierre: la sesión cambió de estado entre la lectura y la escritura.");
      await registrarCambioAuditado(tx, {
        entidad: "SesionCaja",
        entidadId: sesion.id,
        descripcion: "Cierre de caja cancelado",
        campo: "cierre_cancelado",
        valorAnterior: "EN_CIERRE",
        valorNuevo: "ABIERTA",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Cierre de caja cancelado.", { sesionId: sesion.id, yaEstabaAbierta: false });
    },
    undefined,
    undefined,
    true,
  );
}
