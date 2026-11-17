import "server-only";
import { decidirIniciarCierre, estadoDeSesion } from "@/core/caja/public";
import type { ComandoIniciarCierre, ResultadoIniciarCierre } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarSesion, iniciarCierreEnBase } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «iniciar el cierre de la sesión de caja» (etapa C1b, docs/diseno-caja-c1b-en-cierre-2026-11-16.md): la sesión pasa de ABIERTA a EN_CIERRE para contar el efectivo. Mientras está en cierre no se cobra ni se mueve
 * efectivo (`CAJA_EN_CIERRE`); se vuelve a abrir con `cancelarCierreDeSesion` o se termina con `cerrarSesionCasoDeUso`. Decisión del dueño, 2026-11-16: «Frenar el cobro, como Pedernal (Recomendada)».
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE:
 *  1. la sesión es de la sucursal activa (`SESION_NO_ENCONTRADA`);
 *  2. por estado: ABIERTA → inicia (sella quién y cuándo) y audita; ya EN_CIERRE → `yaEstabaEnCierre` sin escribir ni auditar; CERRADA → `SESION_CERRADA` (una cerrada no se reabre).
 * Cobrar contra iniciar el cierre: el cambio de estado es un UPDATE de la sesión y espera a los cobros en vuelo (cada uno la lee con FOR SHARE); el cobro que llega después ve EN_CIERRE y no escribe.
 * Segunda barrera: el disparador de la base deja pasar solo las transiciones del ciclo de la sesión y los CHECK exigen las marcas del cierre iniciado.
 *
 * @contract Deja la sesión EN_CIERRE con quién y cuándo, una sola vez, o no escribe nada.
 * @idempotency Por estado: repetir con la sesión ya en cierre devuelve `yaEstabaEnCierre` sin escribir ni auditar; dos inicios a la vez dejan uno solo (la transacción serializable arbitra y el reintento ve el estado nuevo).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (el inicio del cierre).
 * @ficha permiso=caja_cerrar_sesion transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function iniciarCierreDeSesion(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoIniciarCierre,
): Promise<ResultadoIniciarCierre> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoIniciarCierre> => {
      const sesion = await cargarSesion(tx, actor.empresaId, comando.sesionId);
      if (!sesion || sesion.sucursalId !== actor.sucursalId) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");

      const decision = decidirIniciarCierre(estadoDeSesion(sesion.estado));
      if (decision === "SESION_CERRADA") return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");
      if (decision === "YA_ESTABA") return exito("La caja ya estaba en cierre.", { sesionId: sesion.id, yaEstabaEnCierre: true });

      const escribio = await iniciarCierreEnBase(tx, { empresaId: actor.empresaId, id: sesion.id, cierreIniciadoEn: actor.ahora, cierreIniciadoPorId: actor.usuarioId });
      if (!escribio) throw new Error("iniciarCierre: la sesión cambió de estado entre la lectura y la escritura.");
      await registrarCambioAuditado(tx, {
        entidad: "SesionCaja",
        entidadId: sesion.id,
        descripcion: "Cierre de caja iniciado",
        campo: "cierre_iniciado",
        valorAnterior: "ABIERTA",
        valorNuevo: "EN_CIERRE",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Cierre de caja iniciado.", { sesionId: sesion.id, yaEstabaEnCierre: false });
    },
    undefined,
    undefined,
    true,
  );
}
