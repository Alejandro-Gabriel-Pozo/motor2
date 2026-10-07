import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { redondearACantidadDeUnidad } from "@/core/movimientos/public";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { calcularSaldoPorLote, calcularSaldoTotal } from "@/server/lecturas/movimientos/saldos";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ComoResolverConteo, ResultadoResolverConteo } from "@/core/features/movimientos/resolver-conteo.schema";
import { cargarConteoFisico } from "@/server/persistencia/movimientos/cargar-conteo-fisico";
import { cargarProductoConUnidadDeStock } from "@/server/persistencia/movimientos/cargar-producto-con-unidad-de-stock";
import { actualizarEstadoDeConteo } from "@/server/persistencia/movimientos/escribir-conteo-fisico";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Caso de uso «resolver un conteo pendiente» — port de `resolverConteoPendiente` (Stock.js:2022-2075, Task #41, Fase M, M13e2 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Cierra un conteo que había quedado PENDIENTE ("falta cargar un movimiento").
 * 'resuelto' = el movimiento faltante ya se cargó, el stock se corrigió solo. 'ajustar' = se buscó el movimiento y no aparece — se
 * ajusta contra el saldo de HOY (no el del día del conteo, porque entre medio pudo haber más movimientos).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint, mismo criterio que `registrar-conteo-fisico.ts` (M13e1). No chequea
 * permisos (eso ya lo hizo `conPermiso("conteo_resolver_pendiente")` en el adaptador) ni el formato de la entrada (`guardComandoResolverConteo`, en el adaptador).
 *
 * Orden, igual que antes:
 *  1. `cargarConteoFisico` (M13e2) — si no existe o es de otra sucursal, ni sigue;
 *  2. estado tiene que ser PENDIENTE;
 *  3. rama 'resuelto': cierra directo (`actualizarEstadoDeConteo`, M13e2), sin tocar stock;
 *  4. rama 'ajustar': `cargarProductoConUnidadDeStock` (M13d), saldo de HOY (por lote o total, LEÍDO DENTRO de la transacción
 *     serializable — aborta si otra escritura concurrente lo cambia mientras tanto), diferencia redondeada; si es 0 solo cierra, si
 *     no escribe el ajuste de Kardex vía `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` (M13b, un array de una sola fila)
 *     con `conteoFisicoId: conteo.id` y cierra el conteo.
 *
 * @contract Cierra un conteo PENDIENTE, ajustando el Kardex contra el saldo de HOY si la rama elegida es "ajustar".
 * @idempotency Por estado — exige estado PENDIENTE; un reintento sobre un conteo ya RESUELTO se rechaza con CONTEO_NO_PENDIENTE, no I3.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Escritura del Kardex SOLO si la diferencia contra el saldo de hoy es != 0 y la rama es "ajustar"; sin auditoría de permisos propia.
 * @ficha permiso=conteo_resolver_pendiente transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function resolverConteoPendienteCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  conteoId: string,
  comoResolver: ComoResolverConteo
): Promise<ResultadoResolverConteo> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoResolverConteo> => {
    const conteo = await cargarConteoFisico(tx, conteoId);
    if (!conteo || conteo.sucursalId !== actor.sucursalId) return fracaso("CONTEO_NO_ENCONTRADO", "No se encontró ese conteo.");
    if (conteo.estado !== "PENDIENTE") return fracaso("CONTEO_NO_PENDIENTE", "Ese conteo no está pendiente.");

    if (comoResolver === "resuelto") {
      await actualizarEstadoDeConteo(tx, conteoId, {
        estado: "RESUELTO",
        detalle: `${conteo.detalle ?? ""} — cerrado: se cargó el movimiento que faltaba`.trim(),
      });
      return exito("Conteo cerrado. El stock ya se corrigió con el movimiento que cargaste.", { ajustado: false });
    }

    const producto = await cargarProductoConUnidadDeStock(tx, conteo.productoId);
    if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "El producto ya no existe en el catálogo.");

    const saldoHoy = conteo.loteVencimiento
      ? await calcularSaldoPorLote(conteo.productoId, conteo.seccionId, conteo.loteVencimiento, tx)
      : await calcularSaldoTotal(conteo.productoId, conteo.seccionId, tx);
    const diferencia = redondearACantidadDeUnidad(Number(conteo.conteoReal) - saldoHoy, producto.unidadStock.decimales);

    if (diferencia === 0) {
      await actualizarEstadoDeConteo(tx, conteoId, {
        estado: "RESUELTO",
        detalle: `${conteo.detalle ?? ""} — cerrado: el stock ya coincide`.trim(),
      });
      return exito("El stock ya coincide con lo contado. No hizo falta ajustar.", { ajustado: false });
    }

    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: "CONTROL",
      fecha: actor.ahora,
      proveedorId: null,
      nroFactura: null,
      seccionDestinoId: null,
      motivoId: null,
      destinoId: null,
      detalleLibre: null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: null,
      payloadHash: null,
    });
    await escribirLineasDeMovimientoStock(tx, [
      {
        operacionId: operacion.id,
        productoId: conteo.productoId,
        seccionId: conteo.seccionId,
        proceso: "CONTROL",
        cantidad: diferencia,
        loteVencimiento: conteo.loteVencimiento,
        detalle: `Conteo pendiente resuelto: contado ${conteo.conteoReal}, sistema calculaba ${saldoHoy}, diferencia ${diferencia > 0 ? "+" : ""}${diferencia}.`,
        precioTotal: 0,
        precioPorUnidadStock: 0,
        conteoFisicoId: conteo.id,
      },
    ]);
    await actualizarEstadoDeConteo(tx, conteoId, {
      estado: "RESUELTO",
      detalle: `${conteo.detalle ?? ""} — cerrado con ajuste de ${diferencia > 0 ? "+" : ""}${diferencia}`.trim(),
    });

    return exito(`Conteo cerrado. Se ajustó ${diferencia > 0 ? "+" : ""}${diferencia}.`, { ajustado: true });
  });
}
