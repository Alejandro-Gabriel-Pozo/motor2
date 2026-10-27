import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import type { ResultadoHabilitarMostrador } from "@/core/features/mesas/mesas.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { escribirMostradorNuevo } from "@/server/persistencia/pos/mesas";

/**
 * Caso de uso «habilitar el mostrador de la sucursal» (ADR-039, M1.4b): el administrador crea UNA VEZ el puesto de venta «Mostrador» de la sucursal activa (una `Mesa` de tipo
 * MOSTRADOR y número 0) desde el botón de `/mesas/mostrador`, como da de alta una mesa. El puesto se crea de forma perezosa y explícita: ni la migración ni el alta de la sucursal lo crean.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_alta_mesa")`) ni valida formato (no recibe nada: la sucursal es la
 * del contexto, nunca un dato del navegador).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con `tambienChoqueDeUnico`): 1. la sucursal tiene que estar activa; 2. si ya hay un mostrador → ok «ya estaba habilitado», sin escribir
 * ni auditar; 3. el puesto nuevo (`escribirMostradorNuevo`) y su fila de auditoría (`Mesa.tipo`), juntos. Dos «Habilitar» a la vez: el único `(sucursalId, numero)` arbitra; el que pierde recibe el
 * choque (23505) o el conflicto de serialización (40001), repite, ve el puesto del ganador y responde «ya estaba habilitado»: una sola fila y una sola fila de auditoría.
 *
 * @contract Deja habilitado, en la sucursal activa, el puesto mostrador (una mesa de número 0 y tipo MOSTRADOR), salvo que la sucursal esté desactivada; si ya estaba, no escribe nada.
 * @idempotency Por estado — un mostrador ya habilitado responde ok sin escribir ni auditar; el único `(sucursalId, numero)` y la transacción serializable arbitran la carrera.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque del índice único): la sucursal, el mostrador existente, el alta y la auditoría, todo adentro.
 * @sideEffects registrarCambioAuditado (`Mesa.tipo`, una fila al crear el puesto), en la misma transacción. Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_alta_mesa transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function habilitarMostradorCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion">): Promise<ResultadoHabilitarMostrador> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoHabilitarMostrador> => {
      const sucursal = await tx.sucursal.findFirst({ where: { id: actor.sucursalId }, select: { nombre: true, activo: true } });
      if (!sucursal?.activo) return fracaso("SUCURSAL_INACTIVA", `La sucursal${sucursal ? ` «${sucursal.nombre}»` : ""} está desactivada: no se puede habilitar el mostrador.`);

      const existente = await tx.mesa.findFirst({ where: { sucursalId: actor.sucursalId, tipo: "MOSTRADOR" }, select: { id: true } });
      if (existente) return exito("El mostrador ya estaba habilitado.", { creado: false, mesaId: existente.id });

      const mesaId = await escribirMostradorNuevo(tx, { sucursalId: actor.sucursalId });
      await registrarCambioAuditado(tx, {
        entidad: "Mesa",
        entidadId: mesaId,
        descripcion: `Se habilitó el mostrador de «${sucursal.nombre}»`,
        campo: "tipo",
        valorAnterior: null,
        valorNuevo: "MOSTRADOR",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Mostrador habilitado.", { creado: true, mesaId });
    },
    undefined,
    undefined,
    true,
  );
}
