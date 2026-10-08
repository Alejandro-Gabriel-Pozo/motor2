import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { descripcionAuditoriaAnulacion, evaluarAnulacion, mensajeCompraAnulada } from "@/core/compras/public";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { ComandoAnularCompra, ResultadoAnularCompra } from "@/core/features/compras/compra.schema";
import { detalleReversionDeCompra } from "@/core/movimientos/public";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCompraParaAnular } from "@/server/persistencia/compras/cargar-compra-para-anular";
import { escribirAnulacionDeCompra } from "@/server/persistencia/compras/escribir-anulacion-de-compra";

/**
 * Caso de uso «anular una compra» (K1c; Task #41, Fase M — piloto de `casos-de-uso/`, ver docs/arquitectura-casos-de-uso-2026-09-27.md).
 * Es la orquestación que antes vivía en línea en la Server Action `anularCompra` (src/server/actions/movimientos/compras.ts), en el MISMO
 * orden y con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso` en la Server Action,
 * que le pasa su `ctx`) ni valida formato (eso lo hizo `guardComandoAnularCompra`): recibe un comando ya validado.
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  1. hash de idempotencia I3 (tag "ANULAR_COMPRA", payload `{ operacionId }`, solo si hay clave);
 *  2. `chequearIdempotencia`: un reenvío exacto devuelve el mensaje ORIGINAL (`repetida: true`); la misma clave con otro payload es conflicto;
 *  3. carga de la compra y de sus saldos por lote (persistencia);
 *  4. reglas puras: `evaluarAnulacion`;
 *  5. escritura del contra-asiento y la marca de anulada (persistencia);
 *  6. auditoría (`registrarCambioAuditado`);
 *  7. resultado para la idempotencia (`registrarResultadoIdempotente`, solo si hay clave);
 *  8. el mensaje de éxito.
 *
 * @contract Anula una compra exactamente una vez por claveIdempotencia, revirtiendo su Kardex con un contra-asiento y dejando auditoría.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (campo anuladaEn).
 * @ficha permiso=anular_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoAnularCompra
): Promise<ResultadoAnularCompra> {
  const { operacionId, claveIdempotencia } = comando;

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAnularCompra> => {
    const payloadHash = claveIdempotencia ? calcularPayloadHash("ANULAR_COMPRA", actor.sucursalId, { operacionId }) : "";
    const chequeo = await chequearIdempotencia(tx, claveIdempotencia ?? undefined, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { compraId: operacionId, reversionId: null, movimientosRevertidos: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const compra = await cargarCompraParaAnular(tx, { operacionId, sucursalId: actor.sucursalId });
    if (!compra) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);

    const evaluacion = evaluarAnulacion({ proceso: compra.proceso, anuladaEn: compra.anuladaEn, lineas: compra.lineas }, compra.saldos);
    if (!evaluacion.ok) return fracaso(evaluacion.motivo, evaluacion.mensaje);

    const ahora = actor.ahora;
    const escrita = await escribirAnulacionDeCompra(tx, {
      compraId: compra.id,
      sucursalId: actor.sucursalId,
      usuarioId: actor.usuarioId,
      ahora,
      detalleLibre: detalleReversionDeCompra(compra.id, compra.fecha, compra.nroFactura),
      claveIdempotencia,
      payloadHash: claveIdempotencia ? payloadHash : null,
      reversion: evaluacion.reversion,
    });

    await registrarCambioAuditado(tx, {
      entidad: "Operacion",
      entidadId: compra.id,
      descripcion: descripcionAuditoriaAnulacion(compra.fecha, compra.proveedorNombre, compra.nroFactura),
      campo: "anuladaEn",
      valorAnterior: null,
      valorNuevo: ahora.toISOString(),
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    const mensaje = mensajeCompraAnulada(escrita.movimientos, compra.nroFactura);
    // I3: se persiste el mensaje ya formateado, no se reconstruye (mismo criterio que registrarMovimiento).
    if (claveIdempotencia) await registrarResultadoIdempotente(tx, escrita.reversionId, mensaje);
    return exito(mensaje, { compraId: compra.id, reversionId: escrita.reversionId, movimientosRevertidos: escrita.movimientos, repetida: false });
  });
}
