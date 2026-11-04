import "server-only";
import type { ComandoAnularPagoDeFactura, ResultadoAnularPagoDeFactura } from "@/core/features/compras/factura-proveedor.schema";
import { calcularPayloadHash, esChoqueDeClaveIdempotenciaDePago, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { chequearIdempotencia } from "@/server/persistencia/movimientos/idempotencia";
import { bloquearFacturaParaPago, cargarAnulacionDePagoPorClaveIdempotencia, cargarPagoParaAnular } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { escribirAnulacionDePago } from "@/server/persistencia/compras/escribir-factura-proveedor";

const MENSAJE_NO_ENCONTRADO = "No se encontró ese pago.";

/**
 * Caso de uso «anular un pago declarado» (Pagos X0; docs/diseno-pagos-x0-2026-11-04.md): corrige un pago mal declarado SIN borrarlo. Queda un registro nuevo (`AnulacionDePagoDeFacturaProveedor`, con el motivo) y el pago marcado
 * anulado; la factura vuelve a «pendiente de pago» y admite uno nuevo. No toca el dinero ni el stock de la factura.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `declarar_pago_compra` (clave de EMPRESA) y validó el formato (`guardComandoAnularPagoDeFactura`).
 *
 * Pasos, dentro de UNA transacción SERIALIZABLE: I3 (la clave y la huella van en el registro de anulación); el pago existe en la empresa; `SELECT … FOR UPDATE` de la cabecera de su factura (serializa contra una declaración
 * nueva); ya anulado → «ya está anulado»; `UPDATE … WHERE anuladoEn IS NULL` (0 filas = otra anulación ganó) más el registro de anulación y la auditoría.
 *
 * @contract Anula un pago declarado exactamente una vez por clave, o no anula nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en el registro de anulación), dentro de la misma transacción; además la guarda `anuladoEn IS NULL` y la anulación única por pago.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (la anulación del pago, con el motivo).
 * @ficha permiso=declarar_pago_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularPagoDeFacturaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "db" | "transaccion" | "ahora">,
  comando: ComandoAnularPagoDeFactura
): Promise<ResultadoAnularPagoDeFactura> {
  const payloadHash = calcularPayloadHash("ANULAR_PAGO_FACTURA_PROVEEDOR", actor.empresaId, { pagoId: comando.pagoId, motivo: comando.motivo });

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAnularPagoDeFactura> => {
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash, cargarAnulacionDePagoPorClaveIdempotencia);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const pago = await cargarPagoParaAnular(tx, comando.pagoId);
    if (!pago) return fracaso("NO_ENCONTRADO", MENSAJE_NO_ENCONTRADO);
    // El candado va sobre la cabecera de la factura (la misma fila que toma «declarar»): así una anulación y una declaración nueva se serializan.
    await bloquearFacturaParaPago(tx, pago.facturaProveedorId);
    if (pago.anuladoEn) return fracaso("YA_ANULADO", "El pago ya está anulado.");

    const mensaje = `Pago anulado${pago.nroFactura ? ` (factura ${pago.nroFactura})` : ""}: la factura vuelve a estar pendiente de pago.`;
    const anulados = await escribirAnulacionDePago(tx, {
      pagoId: pago.id,
      usuarioId: actor.usuarioId,
      ahora: actor.ahora,
      motivo: comando.motivo,
      claveIdempotencia: comando.claveIdempotencia,
      payloadHash,
      resultadoMensaje: mensaje,
    });
    if (anulados !== 1) return fracaso("YA_ANULADO", "El pago ya está anulado.");

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: pago.facturaProveedorId,
      descripcion: `Pago de la factura de proveedor${pago.nroFactura ? ` ${pago.nroFactura}` : ""} anulado. Motivo: ${comando.motivo}`,
      campo: "pagoDeclarado",
      valorAnterior: { fechaPago: diaDeColumnaDate(pago.fechaPago), medio: pago.medio },
      valorNuevo: null,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(mensaje, { repetida: false });
  }).catch(async (e): Promise<ResultadoAnularPagoDeFactura> => {
    if (esChoqueDeClaveIdempotenciaDePago(e)) {
      const ganador = await cargarAnulacionDePagoPorClaveIdempotencia(actor.db, comando.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { repetida: true });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}
