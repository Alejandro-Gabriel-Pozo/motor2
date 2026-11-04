import "server-only";
import { decidirDeclaracionDePago, ETIQUETA_DE_MEDIO_DE_PAGO, type CondicionDePago } from "@/core/compras/public";
import type { ComandoDeclararPagoDeFactura, ResultadoDeclararPagoDeFactura } from "@/core/features/compras/factura-proveedor.schema";
import { calcularPayloadHash, esChoqueDeClaveIdempotenciaDePago, esChoqueDePagoVigenteDeFactura, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { chequearIdempotencia } from "@/server/persistencia/movimientos/idempotencia";
import { bloquearFacturaParaPago, cargarPagoPorClaveIdempotencia, tienePagoVigenteLaFactura } from "@/server/persistencia/compras/cargar-factura-proveedor";
import { escribirPagoDeFactura } from "@/server/persistencia/compras/escribir-factura-proveedor";

const MENSAJE_NO_ENCONTRADA = "No se encontró esa factura de proveedor.";

/** `AAAA-MM-DD` → `dd/mm/aaaa` para los mensajes. */
function diaParaMostrar(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Caso de uso «declarar el pago de una factura de proveedor» (Pagos X0; docs/diseno-pagos-x0-2026-11-04.md). La factura se cargó «pendiente de pago»; acá se confirma CUÁNDO y CÓMO se pagó. El pago es un registro
 * nuevo (`PagoDeFacturaProveedor`) que solo se agrega: no toca el dinero ni el stock de la factura.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `declarar_pago_compra` (clave de EMPRESA) y validó el formato (`guardComandoDeclararPagoDeFactura`).
 *
 * Pasos, dentro de UNA transacción SERIALIZABLE:
 *  1. I3: la clave y la huella viven en el registro del pago (repetir lo mismo devuelve el mismo mensaje; la misma clave con otros datos es conflicto);
 *  2. `SELECT … FOR UPDATE` de la cabecera (serializa dos declaraciones y la anulación de la factura); no existe en la empresa → «no se encontró» (la RLS oculta las ajenas);
 *  3. la regla pura `decidirDeclaracionDePago`: factura anulada, factura pagada al cargar, ya con pago vigente, fecha anterior a la de la factura o posterior a hoy (Argentina, reloj del servidor);
 *  4. escribe el pago y la auditoría. Segunda barrera: el índice único parcial de pago vigente (`PagoDeFacturaProveedor_vigente_key`).
 *
 * @contract Declara exactamente un pago vigente por factura pendiente de pago, una sola vez por clave, o no escribe nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en el registro del pago), dentro de la misma transacción; además el índice único parcial de pago vigente.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (el pago declarado).
 * @ficha permiso=declarar_pago_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function declararPagoDeFacturaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "db" | "transaccion" | "ahora">,
  comando: ComandoDeclararPagoDeFactura
): Promise<ResultadoDeclararPagoDeFactura> {
  // La clave de reintento es de EMPRESA (no de sucursal): el mismo pedido reenviado desde otra sucursal sigue siendo el mismo.
  const payloadHash = calcularPayloadHash("DECLARAR_PAGO_FACTURA_PROVEEDOR", actor.empresaId, { facturaId: comando.facturaId, fechaPago: comando.fechaPago, medio: comando.medio });
  const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoDeclararPagoDeFactura> => {
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash, cargarPagoPorClaveIdempotencia);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { repetida: true, pagoId: null });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const factura = await bloquearFacturaParaPago(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);

    const decision = decidirDeclaracionDePago({
      condicionPago: factura.condicionPago as CondicionDePago,
      anulada: factura.anuladaEn !== null,
      tienePagoVigente: await tienePagoVigenteLaFactura(tx, factura.id),
      diaFactura: diaDeCalendario(factura.fecha, ZONA_ARGENTINA),
      diaPago: comando.fechaPago,
      hoy,
    });
    if (!decision.ok) return fracaso(decision.codigo, decision.mensaje);

    const mensaje = `Pago declarado${factura.nroFactura ? ` (factura ${factura.nroFactura})` : ""}: pagada el ${diaParaMostrar(comando.fechaPago)} por ${ETIQUETA_DE_MEDIO_DE_PAGO[comando.medio].toLowerCase()}.`;
    const pago = await escribirPagoDeFactura(tx, {
      facturaProveedorId: factura.id,
      fechaPago: fechaDeColumnaDate(comando.fechaPago),
      medio: comando.medio,
      usuarioId: actor.usuarioId,
      claveIdempotencia: comando.claveIdempotencia,
      payloadHash,
      resultadoMensaje: mensaje,
    });
    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Pago declarado de la factura de proveedor${factura.nroFactura ? ` ${factura.nroFactura}` : ""}`,
      campo: "pagoDeclarado",
      valorAnterior: null,
      valorNuevo: { fechaPago: comando.fechaPago, medio: comando.medio },
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(mensaje, { repetida: false, pagoId: pago.id });
  }).catch(async (e): Promise<ResultadoDeclararPagoDeFactura> => {
    if (esChoqueDePagoVigenteDeFactura(e)) return fracaso("YA_TIENE_PAGO", "La factura ya tiene un pago declarado: anulalo primero si hay que corregirlo.");
    if (esChoqueDeClaveIdempotenciaDePago(e)) {
      const ganador = await cargarPagoPorClaveIdempotencia(actor.db, comando.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { repetida: true, pagoId: null });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}
