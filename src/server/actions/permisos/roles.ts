"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";

export async function listarRoles() {
  const ctx = await requerirVerDeEmpresa("gestion_permisos");
  return ctx.db.rol.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearRolDesdePanel (Core.js:968-983). */
export async function crearRol(nombre: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("gestion_permisos", async (ctx) => {
    const n = texto(nombre).toLowerCase();
    if (!n) return error("El nombre del rol no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del rol");
    if (invalido) return error(invalido);

    const existente = await ctx.db.rol.findFirst({ where: { nombre: n } });
    if (existente) return error(`Ya existe el rol "${n}".`);

    await ctx.db.rol.create({ data: { nombre: n } });
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
  return conPermisoDeEmpresa("gestion_permisos", async (ctx) => {
    const rol = await ctx.db.rol.findUnique({ where: { id: rolId } });
    if (!rol) return error("No se encontró ese rol.");

    if (!activo && rol.nombre === "admin") {
      return error('El rol "admin" no se puede desactivar — sin él nadie podría volver a gestionar Usuarios/Permisos.');
    }

    if (!activo) {
      const enUso = await ctx.db.usuarioSucursal.count({ where: { rolId, activo: true } });
      if (enUso > 0) {
        return error(`No se puede desactivar "${rol.nombre}": todavía hay usuarios activos con ese rol. Reasignalos primero.`);
      }
    }

    await ctx.db.rol.update({ where: { id: rolId }, data: { activo } });

    // Auditoría administrativa (A3, Pivote 6).
    await registrarCambioAuditado(ctx.db, {
      entidad: "Rol", entidadId: rolId, campo: "activo",
      descripcion: `Rol "${rol.nombre}": activo`,
      valorAnterior: rol.activo, valorNuevo: activo, actorId: ctx.usuarioId,
    });

    return ok(`Rol "${rol.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
