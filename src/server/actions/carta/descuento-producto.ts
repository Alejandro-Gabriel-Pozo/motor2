"use server";

import { resolverGrupoDeProducto } from "@/core/carta/grupo-producto-consulta";
import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Producto con descuento (decisión del dueño, 2026-10-01): un porcentaje sobre el precio vigente de UN producto de venta EN LA SUCURSAL ACTIVA
 * (no es una promoción: la promo es la armable de la carta). Fila ausente = sin descuento; vacío o 0 la borra. Se aplica en la carta pública y en el
 * POS, no en la venta de mostrador. Gate: `carta_producto_descuento` (sucursal). Un producto que es opción de un ítem agrupado no admite descuento:
 * el renglón agrupado muestra un solo precio, así que `agregarOpcionItemAgrupadoCarta` bloquea el camino inverso.
 */
export async function guardarDescuentoProducto(productoId: string, porcentaje: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta_producto_descuento", async (ctx) => {
    const validado = validarPorcentajeDescuento(porcentaje, { obligatorio: false });
    if (!validado.ok) return error(validado.mensaje);
    const valor = validado.valor && validado.valor > 0 ? validado.valor : null;

    const producto = await ctx.db.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
    if (!producto) return error("No se encontró el producto.");
    if (producto.tipo !== "PV") return error("Solo un producto de venta (PV) puede tener descuento.");

    const clave = { productoId_sucursalId: { productoId, sucursalId: ctx.sucursalId } };
    const existente = await ctx.db.descuentoProductoSucursal.findUnique({ where: clave });
    if (valor === null) {
      if (!existente) return ok(`«${producto.nombre}» no tenía descuento en esta sucursal.`);
      await ctx.transaccion(async (tx) => {
        await tx.descuentoProductoSucursal.delete({ where: { id: existente.id } });
        await auditar(tx, ctx, existente.id, producto.nombre, Number(existente.porcentaje), null);
      });
      revalidarCartasPublicas();
      return ok(`«${producto.nombre}» vuelve a su precio, sin descuento en esta sucursal.`);
    }

    const grupo = await resolverGrupoDeProducto(productoId, ctx.sucursalId, ctx.db);
    if (grupo) return error(`«${producto.nombre}» es opción del ítem agrupado «${grupo.nombreItem}»: sacala de ahí para ponerle descuento.`);

    await ctx.transaccion(async (tx) => {
      const fila = await tx.descuentoProductoSucursal.upsert({ where: clave, create: { productoId, sucursalId: ctx.sucursalId, porcentaje: valor }, update: { porcentaje: valor } });
      await auditar(tx, ctx, fila.id, producto.nombre, existente ? Number(existente.porcentaje) : null, valor);
    });
    revalidarCartasPublicas();
    return ok(`«${producto.nombre}» con ${valor} % de descuento en esta sucursal.`);
  });
}

async function auditar(
  tx: Parameters<typeof registrarCambioAuditado>[0],
  ctx: { usuarioId: string; sucursalId: string },
  entidadId: string,
  nombre: string,
  anterior: number | null,
  nuevo: number | null
) {
  await registrarCambioAuditado(tx, {
    entidad: "DescuentoProductoSucursal",
    entidadId,
    campo: "porcentaje",
    descripcion: `Descuento de "${nombre}"`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId: ctx.usuarioId,
    sucursalId: ctx.sucursalId,
  });
}
