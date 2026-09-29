"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { validarImporte } from "@/core/datos/importe";
import { ofrecerSincronizarPrecio, resolverGrupoDeProducto } from "@/core/carta/grupo-producto-consulta";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoConSincronizable } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Port de HOJA_PRECIO_LOCAL/"Precio Local" (Catalogo.js:2043-2077) — hueco
 * encontrado investigando Venta (porción Movimientos): Producto.precioVenta
 * es el precio GLOBAL, esto es el override por sucursal. `resolverPrecioVenta`
 * (src/core/movimientos/precio-venta.ts) es quien lee esto — acá solo el CRUD.
 */
export async function obtenerPrecioLocalProducto(sucursalId: string, productoId: string) {
  await requerirVerEnSucursal(sucursalId, "precio_local");
  return prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
}

export async function listarPreciosLocales(sucursalId: string) {
  await requerirVerEnSucursal(sucursalId, "precio_local");
  return prisma.precioLocalProducto.findMany({ where: { sucursalId }, include: { producto: true }, orderBy: { producto: { nombre: "asc" } } });
}

/**
 * Upsert del precio local de un producto en la sucursal activa, con su auditoría (A3, Pivote 6). Sin guarda: la ponen quienes lo llaman.
 * Recibe el cliente de la transacción de quien llama (Task #41, M10): el upsert y sus dos filas de auditoría quedan o todos o ninguno.
 */
async function guardarPrecioLocal(tx: Prisma.TransactionClient, ctx: ContextoUsuario, producto: { id: string; nombre: string }, precio: number, habilitado: boolean) {
  const productoId = producto.id;
  const existente = await tx.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } } });
  const fila = await tx.precioLocalProducto.upsert({
    where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
    update: { precio, habilitado },
    create: { sucursalId: ctx.sucursalId, productoId, precio, habilitado },
  });

  // Auditoría administrativa (A3, Pivote 6).
  await registrarCambioAuditado(tx, {
    entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "precio",
    descripcion: `Precio local de "${producto.nombre}"`,
    valorAnterior: existente ? Number(existente.precio) : null, valorNuevo: Number(precio), actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
  });
  await registrarCambioAuditado(tx, {
    entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "habilitado",
    descripcion: `Precio local de "${producto.nombre}": habilitado`,
    valorAnterior: existente?.habilitado ?? null, valorNuevo: habilitado, actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
  });
}

/**
 * Si el producto está en un ítem agrupado de la carta y, con el precio local HABILITADO, sus hermanos quedaron a otro precio EN ESTA
 * SUCURSAL, el resultado trae además `sincronizable` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): la pantalla ofrece
 * aplicar el mismo precio local con un botón aparte (`sincronizarPrecioLocalGrupoCarta`). Nunca se sincroniza solo.
 */
export async function setPrecioLocalProducto(productoId: string, precio: number, habilitado: boolean): Promise<ResultadoConSincronizable> {
  return conPermiso<ResultadoConSincronizable>("precio_local", async (ctx) => {
    // Mismo validador que el formulario (CampoNumero tipo="importe"): número, no negativo, a lo sumo 2 decimales, dentro del tope.
    const validado = validarImporte(precio, { etiqueta: "El precio", obligatorio: true });
    if (!validado.ok) return error(validado.mensaje);
    precio = validado.valor!; // obligatorio: nunca null

    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    await ctx.transaccion((tx) => guardarPrecioLocal(tx, ctx, producto, precio, habilitado));

    const mensaje = `Precio local de "${producto.nombre}" ${habilitado ? `fijado en ${precio}` : "cargado (deshabilitado, se usa el precio global)"}.`;
    if (habilitado) {
      const sincronizable = ofrecerSincronizarPrecio(await resolverGrupoDeProducto(productoId, ctx.sucursalId), Number(precio), "enSucursal");
      if (sincronizable) return { ok: true, mensaje, sincronizable };
    }
    return ok(mensaje);
  });
}

/**
 * Aplica el mismo precio local (en la sucursal activa) a varios productos de UN mismo ítem agrupado de la carta: el paso que ofrece
 * `setPrecioLocalProducto` con `sincronizable` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Mismo permiso, mismo upsert y
 * misma auditoría que fijarlo a mano en cada uno. `sucursalId` tiene que ser la sucursal activa (la que vio la pantalla): si cambió en
 * el medio, no se escribe nada.
 */
export async function sincronizarPrecioLocalGrupoCarta(sucursalId: string, productoIds: string[], precio: number, habilitado: boolean): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    if (sucursalId !== ctx.sucursalId) return error("La sucursal activa cambió desde que se cargó la pantalla: recargala y volvé a intentar.");
    const validado = validarImporte(precio, { etiqueta: "El precio", obligatorio: true });
    if (!validado.ok) return error(validado.mensaje);
    precio = validado.valor!; // obligatorio: nunca null
    const ids = [...new Set(productoIds)];
    if (!ids.length) return error("No hay productos para actualizar.");

    const grupo = await resolverGrupoDeProducto(ids[0], ctx.sucursalId);
    const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
    if (!grupo || ids.some((id) => !delGrupo.has(id))) return error("Esos productos no están todos en el mismo ítem agrupado de la carta.");

    const productos = await prisma.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
    // Todo el grupo en UNA transacción (Task #41, M10): o quedan todos los precios locales con su auditoría, o ninguno.
    await ctx.transaccion(async (tx) => {
      for (const p of productos) await guardarPrecioLocal(tx, ctx, p, precio, habilitado);
    });
    return ok(`Precio local de ${productos.map((p) => `"${p.nombre}"`).join(", ")} fijado en ${precio} en "${ctx.sucursalNombre}" («${grupo.nombreItem}»).`);
  });
}
