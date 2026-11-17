import "server-only";
import { decidirAjuste, textoDeCentavos } from "@/core/caja/public";
import type { ComandoRegistrarAjuste, ResultadoRegistrarAjuste } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { diaDeColumnaDate, esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarMovimientoDeClave, cargarSesion, cargarTiposDeMedios, insertarMovimiento } from "@/server/persistencia/caja/caja";
import { cargarJornada } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «registrar un ajuste de caja» (etapa C2, CU13; Pedernal `caja/casos-de-uso/registrar-ajuste.ts`, e3 §3.2 y §3.11.3): dinero real sin otro registro, de cualquier medio activo, con signo y motivo, en una sesión ABIERTA. Si corrige una jornada ya
 * cerrada (`corrigeJornada`), el ajuste cae igual en la sesión de hoy y en SU fecha de negocio: la jornada cerrada NO cambia, solo queda enlazada (el error de un día cerrado se corrige con un ajuste del día en curso). `corrigeJornada` es obligatoria (decisión del dueño, 2026-11-16, «Solo sobre días cerrados»): no hay ajuste común.
 *
 * `puedeAjustar` lo decide la Server Action con la acción de ajustar (solo gerente y administrador): sin ella, cierra por defecto (`SIN_PERMISO_PARA_AJUSTAR`), antes de mirar nada. En UNA transacción SERIALIZABLE, en este orden:
 *  1. validación del pedido (importe con signo y distinto de cero, motivo por lista de permitidos, fecha del enlace) y de la sesión (de la sucursal activa);
 *  2. la jornada que corrige: existe, está CERRADA y es ANTERIOR a la de la sesión (`JORNADA_A_CORREGIR_NO_ENCONTRADA`, `JORNADA_A_CORREGIR_NO_CERRADA`, `JORNADA_A_CORREGIR_NO_ANTERIOR`);
 *  3. la clave de reintento se mira ANTES que el estado: misma clave y mismo pedido → el ajuste ya hecho (`yaExistia`); misma clave con otro pedido → `CLAVE_REUTILIZADA`;
 *  4. la sesión está ABIERTA (`SESION_CERRADA`) y el medio existe y está activo (`MEDIO_NO_HABILITADO`); inserta el movimiento AJUSTE y audita.
 * Segunda barrera: el CHECK de clase y signo, el disparador `MovimientoCaja_validar` (jornada de la sesión abierta, medio activo, enlace válido) y el único de la clave.
 *
 * @contract Agrega exactamente un movimiento AJUSTE por clave a una sesión abierta, solo si quien lo pide puede ajustar, o no escribe nada.
 * @idempotency Clave de reintento única por empresa; el pedido se compara campo por campo con el movimiento ya guardado; además el índice único.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el ajuste con su importe, motivo y jornada que corrige).
 * @ficha permiso=movimiento_caja_ajustar transaccion=SERIALIZABLE idempotencia=POR_CLAVE auditoria=REGISTRO_AUDITORIA reloj=NO_APLICA periodo=NO_APLICA
 */
export async function registrarAjusteCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">,
  comando: ComandoRegistrarAjuste,
  puedeAjustar: boolean,
  azar: FuenteDeAzar,
): Promise<ResultadoRegistrarAjuste> {
  if (!puedeAjustar) return fracaso("SIN_PERMISO_PARA_AJUSTAR", "Solo un gerente o un administrador puede registrar un ajuste.");
  if (typeof comando.corrigeJornada !== "string" || !esDiaISOReal(comando.corrigeJornada)) return fracaso("FECHA_INVALIDA", "La fecha de la jornada que se corrige no es válida.");

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoRegistrarAjuste> => {
      const sesion = await cargarSesion(tx, actor.empresaId, comando.sesionId);
      if (!sesion || sesion.sucursalId !== actor.sucursalId) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");

      const jornadaACorregir = await cargarJornada(tx, actor.empresaId, actor.sucursalId, comando.corrigeJornada);
      const ajuste = decidirAjuste({ importeEnCentavos: comando.importeEnCentavos, motivo: comando.motivo, corrigeJornada: comando.corrigeJornada, estadoDeLaJornadaACorregir: jornadaACorregir?.estado ?? null, fechaDeLaSesion: diaDeColumnaDate(sesion.fechaDeNegocio) });
      if (!ajuste.ok) return fracaso(ajuste.error, "El ajuste no es válido.");

      const previo = await cargarMovimientoDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previo) {
        const mismoPedido = previo.sesionId === comando.sesionId && previo.clase === "AJUSTE" && previo.medioDePagoId === comando.medioDePagoId && previo.importeEnCentavos === comando.importeEnCentavos && previo.motivo === ajuste.valor.motivo && previo.corrigeJornada === comando.corrigeJornada && previo.creadoPorId === actor.usuarioId;
        if (!mismoPedido) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otro ajuste.");
        return exito("El ajuste ya estaba registrado.", { movimientoId: previo.id, yaExistia: true });
      }

      if (sesion.estado !== "ABIERTA") return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");
      const medio = (await cargarTiposDeMedios(tx, actor.empresaId, [comando.medioDePagoId])).get(comando.medioDePagoId);
      if (medio?.activo !== true) return fracaso("MEDIO_NO_HABILITADO", "El medio de pago no está habilitado.");

      const movimientoId = azar.uuid();
      await insertarMovimiento(tx, {
        id: movimientoId,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        sesionId: sesion.id,
        clase: "AJUSTE",
        medioDePagoId: comando.medioDePagoId,
        importeEnCentavos: comando.importeEnCentavos,
        motivo: ajuste.valor.motivo,
        anulaAId: null,
        corrigeJornada: comando.corrigeJornada,
        claveIdempotencia: comando.claveIdempotencia,
        creadoPorId: actor.usuarioId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "MovimientoCaja",
        entidadId: movimientoId,
        descripcion: `Ajuste de caja (corrige el día ${comando.corrigeJornada}): ${ajuste.valor.motivo}`,
        campo: "ajuste",
        valorAnterior: null,
        valorNuevo: textoDeCentavos(comando.importeEnCentavos),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Ajuste registrado.", { movimientoId, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
