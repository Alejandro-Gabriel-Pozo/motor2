"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { conPermiso } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

/**
 * Cliente con % de descuento fijo (Task #14, docs/plan-clientes-descuento-2026-09-26.md). Catálogo CENTRAL, sin `sucursalId` — mismo
 * criterio y mismo molde de CRUD que `categorias-producto.ts`/`proveedores.ts`: alta con dedup case-insensible, edición del nombre y
 * el % (no hay un campo "código" separado que sea la identidad, así que a diferencia de Proveedor el nombre SÍ se puede corregir), y
 * activar/desactivar en vez de borrar (una `Cuenta`/`Operacion` ya cerrada referencia su cliente para siempre, FK RESTRICT).
 */

export async function listarClientes(soloActivos = false) {
  await requerirSesion();
  return prisma.cliente.findMany({
    where: soloActivos ? { activo: true } : undefined,
    orderBy: { nombre: "asc" },
  });
}

/** Equivalente de crearCategoriaProducto (mismo dedup case-insensible), con el % de descuento validado (validarPorcentajeDescuento). */
export async function altaCliente(nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("clientes", async () => {
    const n = texto(nombre);
    if (!n) return error("El nombre del cliente no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del cliente");
    if (invalido) return error(invalido);

    const pct = validarPorcentajeDescuento(descuentoPorcentaje);
    if (!pct.ok) return error(pct.mensaje);

    const existente = await prisma.cliente.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return error(`Ya existe un cliente llamado "${existente.nombre}".`);

    const creado = await prisma.cliente.create({ data: { nombre: n, descuentoPorcentaje: pct.valor! } });
    return okConId(`Cliente "${creado.nombre}" creado, con ${pct.valor}% de descuento.`, creado.id, creado.nombre);
  });
}

/**
 * Corrige nombre y/o % de un cliente ya creado. El % nuevo NO reescribe ninguna `Cuenta` ya asignada (D7 — el % queda congelado en
 * `Cuenta.descuentoPorcentaje` al asignar el cliente): solo aplica a asignaciones futuras.
 */
export async function actualizarCliente(clienteId: string, nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoAccion> {
  return conPermiso("clientes", async () => {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return error("No se encontró ese cliente.");

    const n = texto(nombre);
    if (!n) return error("El nombre del cliente no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del cliente");
    if (invalido) return error(invalido);

    const pct = validarPorcentajeDescuento(descuentoPorcentaje);
    if (!pct.ok) return error(pct.mensaje);

    const dup = await prisma.cliente.findFirst({ where: { id: { not: clienteId }, nombre: { equals: n, mode: "insensitive" } } });
    if (dup) return error(`Ya existe un cliente llamado "${dup.nombre}".`);

    await prisma.cliente.update({ where: { id: clienteId }, data: { nombre: n, descuentoPorcentaje: pct.valor! } });
    return ok(`Cliente "${n}" actualizado.`);
  });
}

export async function actualizarActivoCliente(clienteId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("clientes", async () => {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return error("No se encontró ese cliente.");
    await prisma.cliente.update({ where: { id: clienteId }, data: { activo } });
    // Se llama desde la lista sin redirigir después (ver src/server/actions/refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Cliente "${cliente.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
