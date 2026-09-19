"use server";

import { prisma } from "@/lib/db";
import type { AccionClave } from "@/core/permisos/acciones";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVer } from "../con-sesion";

export async function listarCapacidades() {
  await requerirVer("capacidades_sucursal");
  const [acciones, sucursales, capacidades] = await Promise.all([
    prisma.accion.findMany({ where: { clave: { not: "capacidades_sucursal" } }, orderBy: { clave: "asc" } }),
    prisma.sucursal.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    prisma.capacidadSucursal.findMany(),
  ]);
  return { acciones, sucursales, capacidades };
}

/**
 * Equivalente de la escritura detrás de PanelCapacidadesSucursal
 * (Sucursales.js). `sucursalId: null` = fila default (ver
 * CapacidadSucursal en schema.prisma). 'capacidades_sucursal' nunca se
 * puede gobernar a sí misma (Sucursales.js:618 — auto-protección).
 */
export async function actualizarCapacidad(
  accionClave: AccionClave,
  sucursalId: string | null,
  habilitado: boolean
): Promise<ResultadoAccion> {
  return conPermiso("capacidades_sucursal", async (ctx) => {
    if (accionClave === "capacidades_sucursal") {
      return error("Esta acción no se puede gobernar a sí misma.");
    }

    // sucursalId puede ser null (fila default) — el tipo generado del
    // unique compuesto accionClave_sucursalId no acepta null ahí (Prisma
    // no permite un campo nullable como parte del input de una unique
    // compuesta), así que se resuelve con findFirst + create/update en vez
    // de upsert. La unicidad real de "una sola fila default por acción" la
    // garantiza el índice único parcial agregado a mano en la migración
    // (ver schema.prisma, comentario en CapacidadSucursal) — Postgres no
    // la garantiza sola sobre una columna nullable dentro de un @@unique.
    const existente = await prisma.capacidadSucursal.findFirst({ where: { accionClave, sucursalId } });
    let fila;
    if (existente) {
      fila = await prisma.capacidadSucursal.update({ where: { id: existente.id }, data: { habilitado } });
    } else {
      fila = await prisma.capacidadSucursal.create({ data: { accionClave, sucursalId, habilitado } });
    }

    // Auditoría administrativa (A3, Pivote 6).
    await registrarCambioAuditado(prisma, {
      entidad: "CapacidadSucursal", entidadId: fila.id, campo: "habilitado",
      descripcion: `Capacidad "${accionClave}"${sucursalId ? "" : " (default)"}`,
      valorAnterior: existente?.habilitado ?? null, valorNuevo: habilitado, actorId: ctx.usuarioId, sucursalId,
    });

    return ok(`Capacidad de "${accionClave}" actualizada.`);
  });
}
