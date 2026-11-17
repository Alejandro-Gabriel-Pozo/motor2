import "server-only";
import { decidirDeclaracion, textoDeCentavos } from "@/core/caja/public";
import type { ComandoDeclararTotal, ResultadoDeclararTotal } from "@/core/features/caja/caja.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarTiposDeMedios } from "@/server/persistencia/caja/caja";
import { bloquearJornadaCompartida, cargarDeclaracionDeClave, cargarSecuenciasDelMedio, insertarDeclaracion } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «declarar el total de un medio» (etapa C2, CU8; Pedernal `caja/casos-de-uso/declarar-total.ts`, e3b §4.4, decisión 164): el total que dicen los comprobantes de un medio que NO es efectivo (el resumen de la terminal, del QR o del banco).
 * Es opcional y se puede repetir: otra declaración del mismo medio es una fila nueva (`secuencia + 1`) y rige la última; gana siempre sobre el «conforme general». El efectivo NO se declara (`MEDIO_NO_DECLARABLE`): su total es lo contado por billetes.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden: fecha válida (`FECHA_INVALIDA`); la clave de reintento ANTES que el estado (misma clave y mismo pedido →
 * `yaExistia`; otro pedido → `CLAVE_REUTILIZADA`); la jornada `EN_AUDITORIA` tomada `FOR SHARE` (`JORNADA_NO_ENCONTRADA`, `JORNADA_NO_EN_AUDITORIA`, `JORNADA_CERRADA`); el medio existe (`MEDIO_NO_ENCONTRADO`; NO se exige que siga activo: el medio pudo
 * tener actividad y desactivarse después); efectivo e importe fuera de rango se rechazan (`MEDIO_NO_DECLARABLE`, `IMPORTE_INVALIDO`); inserta la declaración y audita.
 * Dos declaraciones del mismo medio a la vez: el único `(jornada, medio, secuencia)` deja pasar una; la otra repite y toma la secuencia siguiente (rige la última en llegar a la base).
 * Segunda barrera: el disparador `DeclaracionDeTotal_validar` (jornada en auditoría, no efectivo, secuencia sin huecos).
 *
 * @contract Agrega exactamente una declaración por clave con la jornada en cierre, o no escribe nada.
 * @idempotency Clave de reintento única por empresa más la huella del pedido; además el único `(jornada, medio, secuencia)`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (la declaración con su secuencia e importe).
 * @ficha permiso=declaracion_de_total_registrar transaccion=SERIALIZABLE idempotencia=POR_CLAVE auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function declararTotalCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoDeclararTotal,
  azar: FuenteDeAzar,
): Promise<ResultadoDeclararTotal> {
  if (!esDiaISOReal(comando.fechaDeNegocio)) return fracaso("FECHA_INVALIDA", "La fecha del día de negocio no es válida.");
  const huella = calcularPayloadHash("DECLARAR_TOTAL", actor.empresaId, { fecha: comando.fechaDeNegocio, medioDePagoId: comando.medioDePagoId, importe: textoDeCentavos(comando.importeEnCentavos) });

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoDeclararTotal> => {
      const previa = await cargarDeclaracionDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previa) {
        if (previa.huella !== huella) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otra declaración.");
        return exito("El total ya estaba declarado.", { declaracionId: previa.id, secuencia: previa.secuencia, yaExistia: true });
      }

      const jornada = await bloquearJornadaCompartida(tx, actor.empresaId, actor.sucursalId, comando.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "Ese día todavía no tiene actividad.");
      if (jornada.estado === "ABIERTA") return fracaso("JORNADA_NO_EN_AUDITORIA", "Los totales solo se declaran durante el cierre del día.");
      if (jornada.estado === "CERRADA") return fracaso("JORNADA_CERRADA", "El día de negocio ya está cerrado.");

      const medio = (await cargarTiposDeMedios(tx, actor.empresaId, [comando.medioDePagoId])).get(comando.medioDePagoId);
      if (medio === undefined) return fracaso("MEDIO_NO_ENCONTRADO", "No se encontró el medio de pago.");
      const declaracion = decidirDeclaracion({ tipoDeMedio: medio.tipo, importeEnCentavos: comando.importeEnCentavos, secuenciasDelMedio: await cargarSecuenciasDelMedio(tx, actor.empresaId, jornada.id, comando.medioDePagoId) });
      if (!declaracion.ok) return fracaso(declaracion.error, declaracion.error === "MEDIO_NO_DECLARABLE" ? "El efectivo no se declara: se cuenta por billetes al cerrar la caja." : "El importe no es válido.");

      const declaracionId = azar.uuid();
      await insertarDeclaracion(tx, {
        id: declaracionId,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        jornadaId: jornada.id,
        medioDePagoId: comando.medioDePagoId,
        secuencia: declaracion.valor.secuencia,
        importeEnCentavos: comando.importeEnCentavos,
        declaradoEn: actor.ahora,
        declaradoPorId: actor.usuarioId,
        claveIdempotencia: comando.claveIdempotencia,
        huella,
      });
      await registrarCambioAuditado(tx, {
        entidad: "DeclaracionDeTotal",
        entidadId: declaracionId,
        descripcion: `Total declarado del medio ${comando.medioDePagoId} para el día ${comando.fechaDeNegocio} (secuencia ${declaracion.valor.secuencia})`,
        campo: "declaracion",
        valorAnterior: null,
        valorNuevo: textoDeCentavos(comando.importeEnCentavos),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Total declarado.", { declaracionId, secuencia: declaracion.valor.secuencia, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
