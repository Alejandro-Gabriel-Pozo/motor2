import "server-only";
import type { ComandoDarConformeGeneral, ResultadoDarConformeGeneral } from "@/core/features/caja/caja.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { bloquearJornadaCompartida, cargarConformeDeClave, cargarConformeDeJornada, insertarConforme } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «conforme general» de la jornada (etapa C2, CU8; Pedernal `caja/casos-de-uso/dar-conforme-general.ts`, e3b §4.4, decisión 164): quien cierra el día acepta, con UN solo acto, lo registrado de TODOS los medios que no son efectivo y que no
 * declaró. Queda con quién y cuándo. NO cubre el efectivo (se cuenta siempre por billetes) y una declaración explícita de un medio gana siempre sobre él. Hay uno solo por jornada: repetirlo (la misma clave, o dos pestañas con claves distintas)
 * devuelve el que ya está con `yaExistia`.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden: fecha válida (`FECHA_INVALIDA`); la clave de reintento ANTES que el estado (`yaExistia` /
 * `CLAVE_REUTILIZADA`); la jornada `EN_AUDITORIA` tomada `FOR SHARE` (`JORNADA_NO_ENCONTRADA`, `JORNADA_NO_EN_AUDITORIA`, `JORNADA_CERRADA`); después, por estado: si la jornada ya tiene conforme → `yaExistia`; si no, lo inserta y audita. Si el cierre se cancela,
 * el conforme sigue. Segunda barrera: el único por jornada y el disparador `ConformeDeJornada_validar`.
 *
 * @contract Deja a lo sumo UN conforme general por jornada, con la jornada en cierre, o no escribe nada.
 * @idempotency Clave de reintento única por empresa más la huella del pedido; además el único por jornada (dos pedidos a la vez con claves distintas dejan uno).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el conforme general de la jornada).
 * @ficha permiso=caja_declarar_total transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function darConformeGeneralCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoDarConformeGeneral,
  azar: FuenteDeAzar,
): Promise<ResultadoDarConformeGeneral> {
  if (!esDiaISOReal(comando.fechaDeNegocio)) return fracaso("FECHA_INVALIDA", "La fecha del día de negocio no es válida.");
  const huella = calcularPayloadHash("DAR_CONFORME_GENERAL", actor.empresaId, { fecha: comando.fechaDeNegocio });

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoDarConformeGeneral> => {
      const previa = await cargarConformeDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previa) {
        if (previa.huella !== huella) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otro pedido.");
        return exito("El conforme general ya estaba dado.", { conformeId: previa.id, yaExistia: true });
      }

      const jornada = await bloquearJornadaCompartida(tx, actor.empresaId, actor.sucursalId, comando.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "Ese día todavía no tiene actividad.");
      if (jornada.estado === "ABIERTA") return fracaso("JORNADA_NO_EN_AUDITORIA", "El conforme general solo se da durante el cierre del día.");
      if (jornada.estado === "CERRADA") return fracaso("JORNADA_CERRADA", "El día de negocio ya está cerrado.");

      const dado = await cargarConformeDeJornada(tx, actor.empresaId, jornada.id);
      if (dado !== null) return exito("El conforme general ya estaba dado.", { conformeId: dado.id, yaExistia: true });

      const conformeId = azar.uuid();
      await insertarConforme(tx, { id: conformeId, empresaId: actor.empresaId, sucursalId: actor.sucursalId, jornadaId: jornada.id, conformePorId: actor.usuarioId, conformeEn: actor.ahora, claveIdempotencia: comando.claveIdempotencia, huella });
      await registrarCambioAuditado(tx, {
        entidad: "ConformeDeJornada",
        entidadId: conformeId,
        descripcion: `Conforme general del día ${comando.fechaDeNegocio}`,
        campo: "conforme",
        valorAnterior: null,
        valorNuevo: "dado",
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Conforme general dado.", { conformeId, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
