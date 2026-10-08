import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { ComandoAnularVenta, ResultadoAnularVenta } from "@/core/features/ventas/venta.schema";
import {
  construirReversionDeVenta,
  descripcionAuditoriaAnulacionDeVenta,
  detalleReversionDeVenta,
  evaluarAnulacionDeVenta,
  mensajeVentaAnulada,
} from "@/core/movimientos/public";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarHermanasDePromo, cargarVentaParaAnular } from "@/server/persistencia/movimientos/cargar-venta-para-anular";
import { escribirAnulacionDeVenta } from "@/server/persistencia/movimientos/escribir-anulacion-de-venta";

/**
 * Caso de uso «anular una venta» (Task #41, Fase M — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes
 * vivía en línea en la Server Action `anularVenta` (src/server/actions/movimientos/venta.ts), en el MISMO orden y con los MISMOS textos;
 * la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("anular_venta")`) ni
 * valida formato (eso lo hizo `guardComandoAnularVenta`). Sin idempotencia I3: `anularVenta` nunca la tuvo (el doble clic lo arbitra el
 * aislamiento SERIALIZABLE, y el segundo intento responde «ya está anulada»).
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  1. carga de la venta pedida, solo de ESTA sucursal (persistencia);
 *  2. reglas puras: `evaluarAnulacionDeVenta` (no es VENTA / ya anulada);
 *  3. hermanas de promo (Task #16, D4): si la venta tiene `promoCuentaId`, las otras Operaciones vigentes de la misma `PromoCuenta` se
 *     anulan en esta misma transacción — una promo nunca queda anulada a medias, se elija el componente que se elija;
 *  4. por cada Operación a anular (la pedida primero): contra-asiento AJUSTE + marca de anulada (persistencia), y su fila de auditoría;
 *  5. el mensaje de éxito.
 *
 * @contract Anula una venta y, si es parte de una promo, TODAS sus hermanas juntas — nunca un componente suelto.
 * @idempotency No aplica (nunca la tuvo) — el aislamiento SERIALIZABLE arbitra el doble clic; el segundo intento ve "ya anulada" (chequeo de estado, no I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (uno por cada Operación anulada, incluidas las hermanas de promo).
 * @ficha permiso=anular_venta transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularVentaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoAnularVenta
): Promise<ResultadoAnularVenta> {
  const { operacionId } = comando;

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAnularVenta> => {
    const venta = await cargarVentaParaAnular(tx, { operacionId, sucursalId: actor.sucursalId });
    if (!venta) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);

    const evaluacion = evaluarAnulacionDeVenta(operacionId, venta);
    if (!evaluacion.ok) return fracaso(evaluacion.motivo, evaluacion.mensaje);

    const hermanas = venta.promoCuentaId ? await cargarHermanasDePromo(tx, { promoCuentaId: venta.promoCuentaId, excluirOperacionId: venta.id }) : [];
    const aAnular = [venta, ...hermanas];

    const ahora = actor.ahora;
    let movimientosRevertidos = 0;
    let huboLiquidacionConsignacion = false;
    const reversionIds: string[] = [];
    for (const op of aAnular) {
      const reversion = construirReversionDeVenta(op.lineas);
      const escrita = await escribirAnulacionDeVenta(tx, {
        ventaId: op.id,
        sucursalId: actor.sucursalId,
        usuarioId: actor.usuarioId,
        ahora,
        detalleLibre: detalleReversionDeVenta(op.id, op.fecha),
        reversion,
      });
      reversionIds.push(escrita.reversionId);
      movimientosRevertidos += escrita.movimientos;
      if (reversion.some((l) => l.proceso === "LIQUIDACION_CONSIGNACION")) huboLiquidacionConsignacion = true;

      // Auditoría administrativa (igual que `anularCompra`): anular una venta mueve stock e ingreso, así que queda quién, cuándo y de cuál.
      await registrarCambioAuditado(tx, {
        entidad: "Operacion",
        entidadId: op.id,
        descripcion: descripcionAuditoriaAnulacionDeVenta(op.fecha, op.nroFactura, hermanas.length > 0),
        campo: "anuladaEn",
        valorAnterior: null,
        valorNuevo: ahora.toISOString(),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    }

    return exito(mensajeVentaAnulada(movimientosRevertidos, huboLiquidacionConsignacion, hermanas.length ? aAnular.length : null), {
      ventaId: venta.id,
      operacionesAnuladas: aAnular.map((op) => op.id),
      reversionIds,
      movimientosRevertidos,
      huboLiquidacionConsignacion,
    });
  });
}
