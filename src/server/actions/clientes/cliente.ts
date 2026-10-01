"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

/**
 * Cliente con % de descuento fijo (Task #14, docs/plan-clientes-descuento-2026-09-26.md). Catálogo CENTRAL, sin `sucursalId` — mismo
 * criterio y mismo molde de CRUD que `categorias-producto.ts`/`proveedores.ts`: alta con dedup case-insensible, edición del nombre y
 * el % (no hay un campo "código" separado que sea la identidad, así que a diferencia de Proveedor el nombre SÍ se puede corregir), y
 * activar/desactivar en vez de borrar (una `Cuenta`/`Operacion` ya cerrada referencia su cliente para siempre, FK RESTRICT).
 *
 * Todo cambio deja su fila en la auditoría administrativa (entidad "Cliente", sin sucursal: es del catálogo central), en la MISMA transacción
 * que el cambio: el % mueve plata (se congela en cada cuenta al asignarlo), así que tiene que quedar quién lo cargó o lo cambió y cuándo.
 */

type Tx = Parameters<typeof registrarCambioAuditado>[0];

async function auditarCliente(tx: Tx, actorId: string, clienteId: string, nombre: string, campo: string, anterior: unknown, nuevo: unknown) {
  await registrarCambioAuditado(tx, {
    entidad: "Cliente",
    entidadId: clienteId,
    campo,
    descripcion: `Cliente "${nombre}": ${campo === "descuentoPorcentaje" ? "% de descuento" : campo === "activo" ? "activo" : "nombre"}`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId,
  });
}

export async function listarClientes(soloActivos = false) {
  const ctx = await requerirSesion();
  return ctx.db.cliente.findMany({
    where: soloActivos ? { activo: true } : undefined,
    orderBy: { nombre: "asc" },
  });
}

/** Equivalente de crearCategoriaProducto (mismo dedup case-insensible), con el % de descuento validado (validarPorcentajeDescuento). */
export async function altaCliente(nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("clientes", async (ctx) => {
    const n = texto(nombre);
    if (!n) return error("El nombre del cliente no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del cliente");
    if (invalido) return error(invalido);

    const pct = validarPorcentajeDescuento(descuentoPorcentaje);
    if (!pct.ok) return error(pct.mensaje);

    const existente = await ctx.db.cliente.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return error(`Ya existe un cliente llamado "${existente.nombre}".`);

    const creado = await ctx.transaccion(async (tx) => {
      const c = await tx.cliente.create({ data: { nombre: n, descuentoPorcentaje: pct.valor! } });
      await auditarCliente(tx, ctx.usuarioId, c.id, c.nombre, "nombre", null, c.nombre);
      await auditarCliente(tx, ctx.usuarioId, c.id, c.nombre, "descuentoPorcentaje", null, pct.valor);
      return c;
    });
    return okConId(`Cliente "${creado.nombre}" creado, con ${pct.valor}% de descuento.`, creado.id, creado.nombre);
  });
}

/**
 * Corrige nombre y/o % de un cliente ya creado. El % nuevo NO reescribe ninguna `Cuenta` ya asignada (D7 — el % queda congelado en
 * `Cuenta.descuentoPorcentaje` al asignar el cliente): solo aplica a asignaciones futuras.
 */
export async function actualizarCliente(clienteId: string, nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("clientes", async (ctx) => {
    const cliente = await ctx.db.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return error("No se encontró ese cliente.");

    const n = texto(nombre);
    if (!n) return error("El nombre del cliente no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del cliente");
    if (invalido) return error(invalido);

    const pct = validarPorcentajeDescuento(descuentoPorcentaje);
    if (!pct.ok) return error(pct.mensaje);

    const dup = await ctx.db.cliente.findFirst({ where: { id: { not: clienteId }, nombre: { equals: n, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un cliente llamado "${dup.nombre}".`);

    await ctx.transaccion(async (tx) => {
      await tx.cliente.update({ where: { id: clienteId }, data: { nombre: n, descuentoPorcentaje: pct.valor! } });
      await auditarCliente(tx, ctx.usuarioId, clienteId, n, "nombre", cliente.nombre, n);
      await auditarCliente(tx, ctx.usuarioId, clienteId, n, "descuentoPorcentaje", Number(cliente.descuentoPorcentaje), pct.valor);
    });
    return ok(`Cliente "${n}" actualizado.`);
  });
}

export async function actualizarActivoCliente(clienteId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("clientes", async (ctx) => {
    const cliente = await ctx.db.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return error("No se encontró ese cliente.");
    await ctx.transaccion(async (tx) => {
      await tx.cliente.update({ where: { id: clienteId }, data: { activo } });
      await auditarCliente(tx, ctx.usuarioId, clienteId, cliente.nombre, "activo", cliente.activo, activo);
    });
    // Se llama desde la lista sin redirigir después (ver src/server/actions/refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Cliente "${cliente.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
