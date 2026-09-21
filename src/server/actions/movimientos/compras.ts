"use server";

import type { Prisma } from "@prisma/client";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { calcularPayloadHash, chequearIdempotencia, esClaveIdempotenciaValida, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import { claveDeLote, evaluarAnulacion, type LineaComprada } from "@/core/compras/anulacion";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);

/**
 * Anula una compra ya confirmada (K1c, docs/planes-implementacion-pendientes-2026-09-21.md §5). Las reglas viven en
 * `src/core/compras/anulacion.ts` (puras y con sus propios tests); esto es la orquestación: permiso, transacción, idempotencia, escritura y auditoría.
 *
 * Mismo criterio append-only que `anularVenta`: la compra original y sus líneas nunca se editan ni se borran. Se escribe una Operación AJUSTE nueva
 * con una línea inversa por cada línea comprada (mismo producto, sección y lote; cantidad y precio total con el signo invertido) y la compra se marca
 * `anuladaEn`/`anuladaPorId`. La reversión lleva el precio de la propia compra, así que se valúa sola al costo original.
 *
 * Se bloquea si lo comprado ya no está en stock (consumido o movido): se compara POR LOTE, no contra el total del producto. La salida en ese caso es una
 * Devolución a proveedor, no anular.
 *
 * Al quedar marcada como anulada, la compra deja de contar en todos los reportes de dinero y su N.º de factura queda libre (índice único parcial de la
 * base y chequeo rápido de `registrarMovimiento`), para poder cargarla de nuevo con el mismo número.
 *
 * Idempotencia (I3): `claveIdempotencia` opcional, un UUID que genera el cliente al abrir la confirmación y reenvía tal cual en un reintento. Cubre el caso
 * «se perdió la respuesta y se reenvió»: devuelve el mensaje original en vez de «ya está anulada». La reversión es una `Operacion` nueva, así que lleva la
 * clave, el hash y el resultado sin ningún cambio de esquema. El doble clic simultáneo lo arbitra el aislamiento SERIALIZABLE.
 *
 * Gate: `anular_compra`, solo admin en la semilla (más restrictivo que `proceso_compra`, que es el permiso para CARGARLA). La sucursal se toma de la
 * sesión: nunca se puede anular la compra de otra sucursal solo adivinando su id.
 *
 * La acción no refresca la vista (`refrescarVistaSiHaceFalta`): quien la llama es un componente de cliente con `useRouter` y pide el `router.refresh()`
 * él mismo (ver `src/server/actions/refrescar.ts`).
 */
export async function anularCompra(operacionId: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("anular_compra", async (ctx) => {
    if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) return error("Clave de reintento inválida.");

    return conTransaccionSerializable(async (tx) => {
      const payloadHash = claveIdempotencia ? calcularPayloadHash("ANULAR_COMPRA", ctx.sucursalId, { operacionId }) : "";
      const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return ok(chequeo.mensaje);
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const operacion = await tx.operacion.findFirst({
        where: { id: operacionId, sucursalId: ctx.sucursalId },
        include: {
          proveedor: { select: { nombre: true } },
          movimientos: { include: { producto: { select: { codigo: true, nombre: true } }, seccion: { select: { nombre: true } } } },
        },
      });
      if (!operacion) return error("No se encontró esa operación en esta sucursal.");

      // Saldo actual por (producto, sección, lote) de lo que esta compra tocó: una sola consulta agrupada.
      const saldosAgrupados = await tx.movimientoStock.groupBy({
        by: ["productoId", "seccionId", "loteVencimiento"],
        where: {
          productoId: { in: [...new Set(operacion.movimientos.map((m) => m.productoId))] },
          seccionId: { in: [...new Set(operacion.movimientos.map((m) => m.seccionId))] },
        },
        _sum: { cantidad: true },
      });
      const saldos = new Map(saldosAgrupados.map((s) => [claveDeLote(s.productoId, s.seccionId, s.loteVencimiento), Number(s._sum.cantidad ?? 0)]));

      const lineas: LineaComprada[] = operacion.movimientos.map((m) => ({
        productoId: m.productoId,
        productoCodigo: m.producto.codigo,
        productoNombre: m.producto.nombre,
        seccionId: m.seccionId,
        seccionNombre: m.seccion.nombre,
        loteVencimiento: m.loteVencimiento,
        cantidad: Number(m.cantidad),
        precioTotal: Number(m.precioTotal),
        precioPorUnidadStock: Number(m.precioPorUnidadStock),
        detalle: m.detalle,
      }));

      const evaluacion = evaluarAnulacion({ proceso: operacion.proceso, anuladaEn: operacion.anuladaEn, lineas }, saldos);
      if (!evaluacion.ok) return error(evaluacion.mensaje);

      const ahora = new Date();
      const reversion = await tx.operacion.create({
        data: {
          sucursalId: ctx.sucursalId,
          proceso: "AJUSTE",
          fecha: ahora,
          detalleLibre: `Anulación de la compra ${operacion.id} (${fechaCorta(operacion.fecha)}${operacion.nroFactura ? `, factura ${operacion.nroFactura}` : ""}).`,
          usuarioId: ctx.usuarioId,
          claveIdempotencia: claveIdempotencia ?? null,
          payloadHash: claveIdempotencia ? payloadHash : null,
        },
      });

      const filas: Prisma.MovimientoStockCreateManyInput[] = evaluacion.reversion.map((l) => ({
        operacionId: reversion.id,
        productoId: l.productoId,
        seccionId: l.seccionId,
        proceso: "AJUSTE",
        cantidad: l.cantidad,
        loteVencimiento: l.loteVencimiento,
        detalle: l.detalle,
        precioTotal: l.precioTotal,
        precioPorUnidadStock: l.precioPorUnidadStock,
      }));
      await tx.movimientoStock.createMany({ data: filas });

      await tx.operacion.update({ where: { id: operacion.id }, data: { anuladaEn: ahora, anuladaPorId: ctx.usuarioId } });

      await registrarCambioAuditado(tx, {
        entidad: "Operacion",
        entidadId: operacion.id,
        descripcion: `Compra del ${fechaCorta(operacion.fecha)}${operacion.proveedor ? ` a ${operacion.proveedor.nombre}` : ""}${operacion.nroFactura ? `, factura ${operacion.nroFactura}` : ""}: anulación`,
        campo: "anuladaEn",
        valorAnterior: null,
        valorNuevo: ahora.toISOString(),
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });

      const mensaje = `Compra anulada. Se revirtieron ${filas.length} línea(s) de stock${operacion.nroFactura ? ` y el N.º de factura ${operacion.nroFactura} quedó libre para volver a cargarla` : ""}.`;
      // I3: se persiste el mensaje ya formateado, no se reconstruye (mismo criterio que registrarMovimiento).
      if (claveIdempotencia) await tx.operacion.update({ where: { id: reversion.id }, data: { resultadoMensaje: mensaje } });
      return ok(mensaje);
    });
  });
}
