"use server";

import { tieneStockReal } from "@/core/movimientos/public";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { restanteDe, validarMotivoAnulacion } from "@/core/pos/cuenta";
import { validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { formatearCantidad } from "./cuenta-comun";

/**
 * Toma de pedido en el salón — anular con motivo lo que YA SALIÓ a cocina (un ítem suelto o una promo entera).
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

/**
 * Anula (total o parcialmente) un ítem que YA SALIÓ a cocina (plan B2/B3): escribe una fila ESPEJO — un CuentaItem nuevo con la
 * cantidad en NEGATIVO, mismo producto/precio/envío, `anulaAItemId` al original, el motivo y quién lo hizo — más una fila en el registro
 * de auditoría (entidad `CuentaItem`, campo `cantidadVigente`). El original nunca se edita ni se borra: lo que queda se calcula
 * (`restanteDe`). Permiso propio, más restrictivo que tomar pedido (el mozo no lo tiene de fábrica).
 *
 * `restanteVisto` es la guarda optimista (mismo criterio que el `esperado` de `corregirCompra`): lo que quedaba del ítem cuando el
 * usuario abrió el diálogo. Si otro lo anuló mientras tanto, se rechaza en vez de anular sobre un número que ya no es el que vio.
 * Una cuenta ya cerrada no se toca: su venta se anula por el camino de siempre (`anularVenta`).
 */
export async function anularItemEnviado(cuentaItemId: string, cantidad: number, motivo: string, restanteVisto: number): Promise<ResultadoAccion> {
  return conPermiso("pos_anular_item", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const item =
        typeof cuentaItemId === "string"
          ? await tx.cuentaItem.findFirst({
              where: { id: cuentaItemId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } },
              include: {
                producto: { select: { tipo: true, nombre: true, pasoVenta: true, seProduce: true, unidadStock: { select: { decimales: true } } } },
                cuenta: { include: { mesa: { select: { numero: true } } } },
                anulaciones: { select: { cantidad: true } },
                promoCuenta: { select: { id: true, titulo: true } },
              },
            })
          : null;
      if (!item) return error("No se encontró ese ítem en esta sucursal.");
      const mesa = item.cuenta.mesa.numero;
      if (item.anulaAItemId !== null) return error("Eso ya es una anulación: no se puede anular.");
      if (item.cuenta.cerradaEn) return error(`La cuenta de la mesa ${mesa} ya se cerró: anulá la venta (Reportes › Trazabilidad).`);
      if (item.numeroEnvio === null) return error("Ese ítem todavía no salió a cocina: usá «Quitar».");
      // Task #16 (D4, "una promo se anula entera"): un componente no se anula suelto — usá anularPromoEnviada con la promo.
      if (item.promoCuenta) return error(`«${item.producto.nombre}» es parte de la promo «${item.promoCuenta.titulo}»: anulá la promo entera.`);

      const motivoValidado = validarMotivoAnulacion(motivo);
      if (!motivoValidado.ok) return error(motivoValidado.mensaje);

      const restante = restanteDe({ cantidad: Number(item.cantidad) }, item.anulaciones.map((a) => ({ cantidad: Number(a.cantidad) })));
      if (typeof restanteVisto !== "number" || restanteVisto !== restante) {
        return error(`«${item.producto.nombre}» cambió mientras lo mirabas (ahora quedan ${formatearCantidad(restante)}): revisá y volvé a intentar.`);
      }
      const pasoDelItem =
        item.producto.pasoVenta !== null ? { pasoVenta: Number(item.producto.pasoVenta), tieneStockReal: tieneStockReal(item.producto.tipo, item.producto.seProduce) } : null;
      const aAnular = validarCantidadPedido(cantidad, item.producto.unidadStock.decimales, pasoDelItem);
      if (!aAnular.ok) return error(aAnular.mensaje);
      if (aAnular.cantidad > restante) return error(`No se puede anular más de lo que queda de «${item.producto.nombre}» (${formatearCantidad(restante)}).`);

      await tx.cuentaItem.create({
        data: {
          cuentaId: item.cuentaId,
          productoId: item.productoId,
          cantidad: -aAnular.cantidad,
          precioUnitario: item.precioUnitario,
          numeroEnvio: item.numeroEnvio,
          anulaAItemId: item.id,
          motivoAnulacion: motivoValidado.motivo,
          creadoPorId: ctx.usuarioId,
        },
      });
      const quedan = restanteDe({ cantidad: restante }, [{ cantidad: -aAnular.cantidad }]);
      await registrarCambioAuditado(tx, {
        entidad: "CuentaItem",
        entidadId: item.id,
        descripcion: `Mesa ${mesa}, envío ${item.numeroEnvio}: anulación de ${formatearCantidad(aAnular.cantidad)} × "${item.producto.nombre}" ya enviado a cocina. Motivo: ${motivoValidado.motivo}`,
        campo: "cantidadVigente",
        valorAnterior: restante,
        valorNuevo: quedan,
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });
      return ok(`Se anuló ${formatearCantidad(aAnular.cantidad)} × «${item.producto.nombre}» de la mesa ${mesa}.`);
    });
  });
}

/**
 * Anula la promo ENTERA ya enviada a cocina (Task #16, D4: "una promo se anula entera, nunca un componente suelto"): crea una
 * fila ESPEJO por CADA componente vigente (el resto que le quedaba, íntegro), cada una con el MISMO `promoCuentaId` — mismo
 * patrón que `anularItemEnviado` (fila espejo + auditoría), pero para TODOS los componentes juntos en una sola llamada, todo
 * o nada. Mismo permiso (`pos_anular_item`, más restrictivo que tomar pedido). Una cuenta ya cerrada no se toca: su venta se
 * anula por el camino de siempre (`anularVenta`, paso 9), que también anula los hermanos.
 */
export async function anularPromoEnviada(promoCuentaId: string, motivo: string): Promise<ResultadoAccion> {
  return conPermiso("pos_anular_item", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const promoCuenta =
        typeof promoCuentaId === "string"
          ? await tx.promoCuenta.findFirst({
              where: { id: promoCuentaId, cuenta: { mesa: { sucursalId: ctx.sucursalId } } },
              include: {
                cuenta: { include: { mesa: { select: { numero: true } } } },
                items: { include: { producto: { select: { nombre: true } }, anulaciones: { select: { cantidad: true } } } },
              },
            })
          : null;
      if (!promoCuenta) return error("No se encontró esa promo en esta sucursal.");
      const mesa = promoCuenta.cuenta.mesa.numero;
      if (promoCuenta.cuenta.cerradaEn) return error(`La cuenta de la mesa ${mesa} ya se cerró: anulá la venta (Reportes › Trazabilidad).`);

      const originales = promoCuenta.items.filter((i) => i.anulaAItemId === null);
      if (originales.length === 0) return error("Esa promo no tiene ningún componente.");
      if (originales.some((i) => i.numeroEnvio === null)) return error("Esa promo todavía no salió a cocina: usá «Quitar promo».");

      const motivoValidado = validarMotivoAnulacion(motivo);
      if (!motivoValidado.ok) return error(motivoValidado.mensaje);

      const aAnular = originales
        .map((item) => ({ item, restante: restanteDe({ cantidad: Number(item.cantidad) }, item.anulaciones.map((a) => ({ cantidad: Number(a.cantidad) }))) }))
        .filter((x) => x.restante > 0);
      if (!aAnular.length) return error(`La promo «${promoCuenta.titulo}» ya está anulada entera.`);

      for (const { item, restante } of aAnular) {
        await tx.cuentaItem.create({
          data: {
            cuentaId: item.cuentaId,
            productoId: item.productoId,
            cantidad: -restante,
            precioUnitario: item.precioUnitario,
            numeroEnvio: item.numeroEnvio,
            anulaAItemId: item.id,
            motivoAnulacion: motivoValidado.motivo,
            creadoPorId: ctx.usuarioId,
            promoCuentaId: promoCuenta.id,
            precioCartaUnitario: item.precioCartaUnitario,
          },
        });
        await registrarCambioAuditado(tx, {
          entidad: "CuentaItem",
          entidadId: item.id,
          descripcion: `Mesa ${mesa}, envío ${item.numeroEnvio}: anulación de la promo «${promoCuenta.titulo}» ya enviada a cocina — ${formatearCantidad(restante)} × "${item.producto.nombre}". Motivo: ${motivoValidado.motivo}`,
          campo: "cantidadVigente",
          valorAnterior: restante,
          valorNuevo: 0,
          actorId: ctx.usuarioId,
          sucursalId: ctx.sucursalId,
        });
      }
      return ok(`Se anuló la promo «${promoCuenta.titulo}» de la mesa ${mesa} (${aAnular.length} componente${aAnular.length === 1 ? "" : "s"}).`);
    });
  });
}
