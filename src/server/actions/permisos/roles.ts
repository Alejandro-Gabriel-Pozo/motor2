"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirSesion } from "../con-sesion";

export async function listarRoles() {
  await requerirSesion();
  return prisma.rol.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearRolDesdePanel (Core.js:968-983). */
export async function crearRol(nombre: string): Promise<ResultadoAccion> {
  return conPermiso("gestion_permisos", async () => {
    const n = texto(nombre).toLowerCase();
    if (!n) return error("El nombre del rol no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del rol");
    if (invalido) return error(invalido);

    const existente = await prisma.rol.findUnique({ where: { nombre: n } });
    if (existente) return error(`Ya existe el rol "${n}".`);

    await prisma.rol.create({ data: { nombre: n } });
    return ok(`Rol "${n}" creado.`);
  });
}

/**
 * Equivalente de actualizarActivoRol (Core.js:994-1018): dos salvaguardas,
 * mismo espíritu que ya existe para Usuarios (nunca dejar el sistema sin
 * ningún admin activo):
 *   - 'admin' nunca se puede desactivar.
 *   - un rol con membresías ACTIVAS asignadas no se puede desactivar sin
 *     reasignarlas antes.
 */
export async function actualizarActivoRol(rolId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("gestion_permisos", async (ctx) => {
    const rol = await prisma.rol.findUnique({ where: { id: rolId } });
    if (!rol) return error("No se encontró ese rol.");

    if (!activo && rol.nombre === "admin") {
      return error('El rol "admin" no se puede desactivar — sin él nadie podría volver a gestionar Usuarios/Permisos.');
    }

    if (!activo) {
      const enUso = await prisma.usuarioSucursal.count({ where: { rolId, activo: true } });
      if (enUso > 0) {
        return error(`No se puede desactivar "${rol.nombre}": todavía hay usuarios activos con ese rol. Reasignalos primero.`);
      }
    }

    await prisma.rol.update({ where: { id: rolId }, data: { activo } });

    // Auditoría administrativa (A3, Pivote 6).
    await registrarCambioAuditado(prisma, {
      entidad: "Rol", entidadId: rolId, campo: "activo",
      descripcion: `Rol "${rol.nombre}": activo`,
      valorAnterior: rol.activo, valorNuevo: activo, actorId: ctx.usuarioId,
    });

    return ok(`Rol "${rol.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
