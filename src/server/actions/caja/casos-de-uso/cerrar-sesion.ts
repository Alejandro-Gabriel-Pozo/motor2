import "server-only";
import { diferenciaDeArqueo, textoDeCentavos, totalContadoEnCentavos } from "@/core/caja/public";
import type { ComandoCerrarSesion, ResultadoCerrarSesion } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { centavosDeDecimal, cargarSesion, cargarTiposDeMedios, cerrarSesionEnBase, insertarArqueo, insertarBilletes, sumarMovimientosPorMedioYCuenta } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «cerrar la sesión de caja con arqueo» (etapa C1, CU7): el efectivo se CUENTA por billetes y monedas; los demás (medio, cuenta de cobro) con movimientos se dan por «conforme» (C3: una línea por cada par; «sin cuenta» es un grupo más). La diferencia (contado − esperado) se CALCULA y
 * nadie la escribe; cerrar con diferencia se PERMITE y queda auditado (igual que Pedernal, PROPUESTA). Una sesión cerrada no se reabre.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE:
 *  1. la sesión es de la sucursal activa; si ya está cerrada y el conteo da lo mismo → `yaEstabaCerrada` (idempotente), con otro conteo → `SESION_CERRADA`;
 *  2. el conteo vale (`totalContadoEnCentavos`); si hubo movimientos en otro medio y no se dio «conforme» → `CONFORME_FALTANTE`;
 *  3. recalcula lo esperado por medio desde los movimientos, escribe un arqueo por medio, los billetes y cierra la sesión; audita el cierre y, si hay diferencia, `cierre_con_diferencia`.
 * Segunda barrera: el disparador diferido de la base recalcula el esperado al confirmar y exige que el arqueo cuadre con lo movido y que billetes + monedas den lo contado; un cobro que se cuele entre medio hace fallar el cierre entero.
 *
 * @contract Cierra la sesión una sola vez con un arqueo que cuadra con sus movimientos, o no escribe nada.
 * @idempotency Por estado: repetir el cierre con el mismo conteo devuelve `yaEstabaCerrada`; la base impide cerrar dos veces (la sesión cerrada no se toca) y la transacción serializable arbitra la carrera.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cierre, y la diferencia si la hay).
 * @ficha permiso=caja_cerrar_sesion transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cerrarSesionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoCerrarSesion,
  azar: FuenteDeAzar,
): Promise<ResultadoCerrarSesion> {
  const contado = totalContadoEnCentavos(comando.conteo);
  if (!contado.ok) return fracaso("CONTEO_INVALIDO", `El conteo no vale (${contado.error}).`);

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCerrarSesion> => {
      const sesion = await cargarSesion(tx, actor.empresaId, comando.sesionId);
      if (!sesion || sesion.sucursalId !== actor.sucursalId) return fracaso("SESION_NO_ENCONTRADA", "No se encontró la sesión de caja.");

      // El arqueo se lleva por (medio, cuenta de cobro); «sin cuenta» es un grupo más y el efectivo nunca lleva cuenta.
      const esperados = await sumarMovimientosPorMedioYCuenta(tx, actor.empresaId, sesion.id);
      const tipos = await cargarTiposDeMedios(tx, actor.empresaId, [...new Set(esperados.map((e) => e.medioDePagoId))]);
      const lineaDeEfectivo = esperados.find((e) => tipos.get(e.medioDePagoId)?.tipo === "EFECTIVO");
      if (lineaDeEfectivo === undefined) throw new Error("cerrarSesion: la sesión no tiene el movimiento de fondo (efectivo).");
      const idEfectivo = lineaDeEfectivo.medioDePagoId;
      const diferencia = diferenciaDeArqueo(contado.centavos, lineaDeEfectivo.esperadoEnCentavos);

      if (sesion.estado === "CERRADA") {
        const arqueo = await tx.arqueoCaja.findFirst({ where: { empresaId: actor.empresaId, sesionId: sesion.id, medioDePagoId: idEfectivo, cuentaDeCobroId: null }, select: { contado: true } });
        if (arqueo?.contado && centavosDeDecimal(arqueo.contado) === contado.centavos) return exito("La caja ya estaba cerrada.", { sesionId: sesion.id, yaEstabaCerrada: true, diferenciaEnEfectivoEnCentavos: diferencia });
        return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");
      }

      const hayOtrosMedios = esperados.some((e) => e.medioDePagoId !== idEfectivo);
      if (hayOtrosMedios && !comando.conformeDeLosDemasMedios) return fracaso("CONFORME_FALTANTE", "Hay movimientos en otros medios de pago: dalos por conformes para cerrar.");

      for (const { medioDePagoId: medioId, cuentaDeCobroId, esperadoEnCentavos: esperado } of esperados) {
        const esEfectivo = medioId === idEfectivo;
        await insertarArqueo(tx, {
          id: azar.uuid(), empresaId: actor.empresaId, sucursalId: actor.sucursalId, sesionId: sesion.id, medioDePagoId: medioId, cuentaDeCobroId, esperadoEnCentavos: esperado,
          contadoEnCentavos: esEfectivo ? contado.centavos : null, monedasEnCentavos: esEfectivo ? comando.conteo.monedasEnCentavos : null, conforme: !esEfectivo,
        });
      }
      await insertarBilletes(
        tx,
        Object.entries(comando.conteo.billetes).flatMap(([den, cantidad]) => (cantidad === undefined ? [] : [{ id: azar.uuid(), empresaId: actor.empresaId, sucursalId: actor.sucursalId, sesionId: sesion.id, denominacion: Number(den), cantidad }])),
      );
      const escribio = await cerrarSesionEnBase(tx, { empresaId: actor.empresaId, id: sesion.id, cerradaEn: actor.ahora, cerradaPorId: actor.usuarioId, observacion: comando.observacion });
      if (!escribio) return fracaso("SESION_CERRADA", "La sesión de caja ya está cerrada.");

      await registrarCambioAuditado(tx, {
        entidad: "SesionCaja",
        entidadId: sesion.id,
        descripcion: "Caja cerrada con arqueo",
        campo: "cierre",
        valorAnterior: "ABIERTA",
        valorNuevo: `CERRADA; contado ${textoDeCentavos(contado.centavos)}`,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      if (diferencia !== BigInt(0)) {
        await registrarCambioAuditado(tx, {
          entidad: "SesionCaja",
          entidadId: sesion.id,
          descripcion: "Cierre de caja con diferencia en efectivo",
          campo: "cierre_con_diferencia",
          valorAnterior: null,
          valorNuevo: textoDeCentavos(diferencia),
          actorId: actor.usuarioId,
          sucursalId: actor.sucursalId,
        });
      }
      return exito("Caja cerrada.", { sesionId: sesion.id, yaEstabaCerrada: false, diferenciaEnEfectivoEnCentavos: diferencia });
    },
    undefined,
    undefined,
    true,
  );
}
