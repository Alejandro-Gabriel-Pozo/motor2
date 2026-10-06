"use server";

import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { mensajeSiNombreDeRolNoPermitido, normalizarNombreDeRol } from "@/core/permisos/nombres-de-rol";
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

/** Equivalente de crearRolDesdePanel (Core.js:968-983). El nombre sigue las reglas de `core/permisos/nombres-de-rol` (los de fábrica están reservados). */
export async function crearRol(nombre: string): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_roles", async (ctx) => {
    const n = normalizarNombreDeRol(nombre);
    const rechazo = mensajeSiNombreDeRolNoPermitido(n, null);
    if (rechazo) return error(rechazo);

    const existente = await ctx.db.rol.findFirst({ where: { nombre: n } });
    if (existente) return error(`Ya existe el rol "${n}".`);

    try {
      await ctx.transaccion(async (tx) => {
        const rol = await tx.rol.create({ data: { nombre: n } });
        await registrarCambioAuditado(tx, {
          entidad: "Rol", entidadId: rol.id, campo: "nombre", descripcion: `Rol "${n}": alta`,
          valorAnterior: null, valorNuevo: n, actorId: ctx.usuarioId,
        });
      });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe el rol "${n}".`);
      throw e;
    }
    return ok(`Rol "${n}" creado.`);
  });
}

/**
 * Cambia el NOMBRE de un rol (G3). Nunca toca la clave: un rol de sistema («admin», «operador») sigue siendo el mismo con otro nombre, porque el
 * código lo reconoce por la clave. Acción propia (`renombrar_rol`, piso administrador). El nombre nuevo no puede estar tomado por otro rol ni ser uno
 * de los reservados de otro rol; el cambio queda en la auditoría con el nombre anterior y el nuevo.
 */
export async function renombrarRol(rolId: string, nombre: string): Promise<ResultadoAccion> {
  return conEdicionDePermisos("renombrar_rol", async (ctx) => {
    const n = normalizarNombreDeRol(nombre);
    try {
      return await conGobierno(ctx, async (tx) => {
        const rol = await tx.rol.findUnique({ where: { id: rolId } });
        if (!rol) return error("No se encontró ese rol.");

        const rechazo = mensajeSiNombreDeRolNoPermitido(n, rol.clave);
        if (rechazo) return error(rechazo);

        const tomado = await tx.rol.findFirst({ where: { nombre: n, id: { not: rolId } }, select: { id: true } });
        if (tomado) return error(`Ya existe el rol "${n}".`);

        await tx.rol.update({ where: { id: rolId }, data: { nombre: n } });
        await registrarCambioAuditado(tx, {
          entidad: "Rol", entidadId: rolId, campo: "nombre",
          descripcion: `Rol "${rol.nombre}": nombre`,
          valorAnterior: rol.nombre, valorNuevo: n, actorId: ctx.usuarioId,
        });
        return ok(`Rol "${rol.nombre}" renombrado a "${n}".`);
      });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe el rol "${n}".`);
      throw e;
    }
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
