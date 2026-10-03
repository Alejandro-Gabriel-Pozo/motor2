"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { invarianteRolDeSistemaIntacto, invarianteRolSinUsuariosActivos } from "@/core/permisos/invariantes";
import { conEdicionDePermisos } from "../con-permiso";
import { conGobierno } from "../con-gobierno";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";

export async function listarRoles() {
  const ctx = await requerirVerDeEmpresa("gestion_roles");
  return ctx.db.rol.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearRolDesdePanel (Core.js:968-983). */
export async function crearRol(nombre: string): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_roles", async (ctx) => {
    const n = texto(nombre).toLowerCase();
    if (!n) return error("El nombre del rol no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del rol");
    if (invalido) return error(invalido);

    const existente = await ctx.db.rol.findFirst({ where: { nombre: n } });
    if (existente) return error(`Ya existe el rol "${n}".`);

    await ctx.transaccion(async (tx) => {
      const rol = await tx.rol.create({ data: { nombre: n } });
      await registrarCambioAuditado(tx, {
        entidad: "Rol", entidadId: rol.id, campo: "nombre", descripcion: `Rol "${n}": alta`,
        valorAnterior: null, valorNuevo: n, actorId: ctx.usuarioId,
      });
    });
    return ok(`Rol "${n}" creado.`);
  });
}

/**
 * Equivalente de actualizarActivoRol (Core.js:994-1018): dos salvaguardas de gobierno (G2), con la regla en `core/permisos/invariantes`:
 *   - (c) un rol de sistema (con clave: «admin» y «operador») no se desactiva: la empresa lo necesita para gobernarse;
 *   - (e) un rol con usuarios ACTIVOS asignados (cualquier sucursal) no se desactiva sin reasignarlos antes.
 * Se lee y se escribe en la misma transacción serializable: una alta simultánea con ese rol no cuela a alguien en un rol recién apagado.
 */
export async function actualizarActivoRol(rolId: string, activo: boolean): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_roles", async (ctx) =>
    conGobierno(ctx, async (tx) => {
      const rol = await tx.rol.findUnique({ where: { id: rolId } });
      if (!rol) return error("No se encontró ese rol.");

      if (!activo) {
        const rechazo = invarianteRolDeSistemaIntacto(rol) ?? (await invarianteRolSinUsuariosActivos(tx, rol));
        if (rechazo) return error(rechazo);
      }

      await tx.rol.update({ where: { id: rolId }, data: { activo } });

      // Auditoría administrativa (A3, Pivote 6).
      await registrarCambioAuditado(tx, {
        entidad: "Rol", entidadId: rolId, campo: "activo",
        descripcion: `Rol "${rol.nombre}": activo`,
        valorAnterior: rol.activo, valorNuevo: activo, actorId: ctx.usuarioId,
      });

      return ok(`Rol "${rol.nombre}" ${activo ? "activado" : "desactivado"}.`);
    }),
  );
}
