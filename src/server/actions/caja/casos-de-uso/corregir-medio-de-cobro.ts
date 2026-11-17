import "server-only";
import { decidirCorreccionDeMedio, medioVigenteDelCobro, motivoObligatorio, textoDeCentavos } from "@/core/caja/public";
import type { ComandoCorregirMedioDeCobro, ResultadoCorregirMedioDeCobro } from "@/core/features/caja/caja.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarTiposDeMedios } from "@/server/persistencia/caja/caja";
import { bloquearJornadaCompartida, cargarCobroParaCorregir, cargarCorreccionDeClave, insertarCorreccion } from "@/server/persistencia/caja/jornada";

/**
 * Caso de uso «corregir el medio de un cobro» (etapa C2, CU8; Pedernal `caja/casos-de-uso/corregir-medio-de-cobro.ts`, e3b §4.3, decisión 163): traslada el IMPORTE COMPLETO del cobro del medio vigente a otro cualquiera, con motivo. El cobro original queda
 * como estaba y no cambia el esperado ni el arqueo de ninguna sesión: solo mueve la conciliación del día. Un cobro no se anula desde la caja: un error de medio se corrige así.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden:
 *  1. el cobro es de la sucursal activa (`COBRO_NO_ENCONTRADO`) y el motivo vale (`MOTIVO_INVALIDO`, lista de permitidos);
 *  2. la clave de reintento se mira ANTES que el estado: misma clave y mismo pedido → la corrección ya hecha (`yaExistia`, sin escribir ni auditar); misma clave con otro pedido → `CLAVE_REUTILIZADA`;
 *  3. la jornada del cobro (la fecha de negocio de su sesión) está `EN_AUDITORIA`, tomada `FOR SHARE`: el cierre concurrente espera y la que llega después lo encuentra cerrado (`JORNADA_NO_EN_AUDITORIA`, `JORNADA_CERRADA`);
 *  4. el medio vigente no cambió desde que este pedido empezó (`MEDIO_DEL_COBRO_CAMBIO { vigenteId }`: no se pisa en silencio la decisión de otra persona), el destino no es lo ya vigente (`MEDIO_DEL_COBRO_SIN_CAMBIOS`) y es un medio activo
 *     (`MEDIO_NO_ENCONTRADO`, `MEDIO_NO_HABILITADO`);
 *  5. inserta la corrección (`secuencia + 1` del cobro) y la audita.
 * Dos correcciones del mismo cobro a la vez: el único `(cobro, secuencia)` deja pasar una; la otra repite su transacción, ve el medio nuevo y, como ya no es el que vio al empezar, devuelve `MEDIO_DEL_COBRO_CAMBIO`.
 * Segunda barrera: el disparador `CorreccionDeMedio_validar` (jornada en auditoría, secuencia sin huecos, «antes» = el vigente, destino activo).
 *
 * @contract Agrega exactamente una corrección por clave, partiendo del medio vigente y con la jornada en cierre, o no escribe nada.
 * @idempotency Clave de reintento única por empresa más la huella del pedido; además el único `(cobro, secuencia)`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (la corrección con medio de antes y de después, importe y motivo).
 * @ficha permiso=caja_corregir_medio_de_cobro transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function corregirMedioDeCobroCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoCorregirMedioDeCobro,
  azar: FuenteDeAzar,
): Promise<ResultadoCorregirMedioDeCobro> {
  const motivo = motivoObligatorio(comando.motivo);
  if (!motivo.ok) return fracaso("MOTIVO_INVALIDO", "El motivo es obligatorio y tiene caracteres que no se admiten.");
  const huella = calcularPayloadHash("CORREGIR_MEDIO_DE_COBRO", actor.empresaId, { cobroId: comando.cobroId, medioDestinoId: comando.medioDestinoId, motivo: motivo.valor });
  // El medio vigente que vio el primer intento de ESTE pedido: si al repetirse la transacción es otro, alguien corrigió el cobro entre medio.
  let vigenteAlEmpezar: string | null = null;

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCorregirMedioDeCobro> => {
      const cobro = await cargarCobroParaCorregir(tx, actor.empresaId, comando.cobroId);
      if (cobro === null || cobro.sucursalId !== actor.sucursalId) return fracaso("COBRO_NO_ENCONTRADO", "No se encontró el cobro.");

      const previa = await cargarCorreccionDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (previa) {
        if (previa.huella !== huella) return fracaso("CLAVE_REUTILIZADA", "Esta clave ya se usó con otra corrección.");
        return exito("La corrección ya estaba registrada.", { correccionId: previa.id, secuencia: previa.secuencia, yaExistia: true });
      }

      const jornada = await bloquearJornadaCompartida(tx, actor.empresaId, actor.sucursalId, cobro.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "No se encontró el día de negocio del cobro.");
      if (jornada.estado === "ABIERTA") return fracaso("JORNADA_NO_EN_AUDITORIA", "El medio de un cobro solo se corrige durante el cierre del día.");
      if (jornada.estado === "CERRADA") return fracaso("JORNADA_CERRADA", "El día de negocio ya está cerrado.");

      const vigenteId = medioVigenteDelCobro(cobro.medioDePagoId, cobro.correcciones);
      if (vigenteAlEmpezar === null) vigenteAlEmpezar = vigenteId;
      else if (vigenteAlEmpezar !== vigenteId) return { ...fracaso("MEDIO_DEL_COBRO_CAMBIO", "Otra persona acaba de corregir el medio de este cobro: volvé a mirarlo."), vigenteId };
      const correccion = decidirCorreccionDeMedio({ medioOriginalId: cobro.medioDePagoId, correcciones: cobro.correcciones, destinoId: comando.medioDestinoId });
      if (!correccion.ok) return fracaso(correccion.error, "El cobro ya está en ese medio.");

      const destino = (await cargarTiposDeMedios(tx, actor.empresaId, [comando.medioDestinoId])).get(comando.medioDestinoId);
      if (destino === undefined) return fracaso("MEDIO_NO_ENCONTRADO", "No se encontró el medio de pago.");
      if (!destino.activo) return fracaso("MEDIO_NO_HABILITADO", "El medio de pago no está habilitado.");

      const correccionId = azar.uuid();
      const { medioAntesId, secuencia } = correccion.valor;
      await insertarCorreccion(tx, {
        id: correccionId,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        jornadaId: jornada.id,
        cobroId: cobro.cobroId,
        secuencia,
        medioAntesId,
        medioDespuesId: comando.medioDestinoId,
        motivo: motivo.valor,
        corregidoEn: actor.ahora,
        corregidoPorId: actor.usuarioId,
        claveIdempotencia: comando.claveIdempotencia,
        huella,
      });
      await registrarCambioAuditado(tx, {
        entidad: "CorreccionDeMedio",
        entidadId: correccionId,
        descripcion: `Medio del cobro ${cobro.cobroId} corregido (${textoDeCentavos(cobro.importeEnCentavos)}): ${motivo.valor}`,
        campo: "medio",
        valorAnterior: medioAntesId,
        valorNuevo: comando.medioDestinoId,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Medio de pago corregido.", { correccionId, secuencia, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
