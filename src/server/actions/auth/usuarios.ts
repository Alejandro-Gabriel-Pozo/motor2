"use server";

import type { Db } from "@/lib/db-tipos";
import { texto } from "@/core/texto";
import { requierePermiso } from "@/core/permisos/gate";
import { esGerenteDeEmpresa } from "@/core/permisos/rol-empresa";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * Techo de privilegio: `gestion_usuarios` no alcanza para dar el rol admin ni para tocar a un admin — si no, un rol con ese
 * permiso se promueve a sí mismo (o degrada al admin). Lo puede hacer un admin de esa sucursal o quien tiene el rol de empresa
 * «gerente» (`UsuarioEmpresa.rolEmpresa`), que es la autoridad sobre usuarios de toda la empresa.
 */
function puedeTocarAdmins(ctx: { rolEmpresa: string | null }, esAdminEnLaSucursal: boolean): boolean {
  return esAdminEnLaSucursal || esGerenteDeEmpresa(ctx.rolEmpresa);
}

async function contarAdminsActivosExcluyendo(db: Db, empresaId: string, idExcluido?: string): Promise<number> {
  return db.usuarioSucursal.count({
    where: {
      empresaId,
      activo: true,
      rol: { nombre: "admin", activo: true },
      ...(idExcluido ? { id: { not: idExcluido } } : {}),
    },
  });
}

export async function listarUsuariosDeSucursal(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "gestion_usuarios");
  return ctx.db.usuarioSucursal.findMany({
    where: { sucursalId },
    include: { usuario: true, rol: true },
    orderBy: { creadoEn: "asc" },
  });
}

/**
 * Equivalente de guardarUsuarioDesdePanel (Core.js:1142-1180): agrega o
 * actualiza la membresía de un email en una sucursal. Si el email no
 * corresponde a ningún User todavía (no inició sesión nunca), se crea el
 * registro igual — queda vinculado automáticamente la primera vez que esa
 * persona haga login con Google (ver allowDangerousEmailAccountLinking en
 * src/lib/auth.ts).
 */
export async function agregarOActualizarUsuario(input: {
  email: string;
  sucursalId: string;
  rolId: string;
  notas?: string;
}): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const email = texto(input.email).toLowerCase();
    if (!email) return error("El email es obligatorio.");

    const rol = await ctx.db.rol.findFirst({ where: { id: input.rolId, empresaId: ctx.empresaId } });
    if (!rol || !rol.activo) return error("Rol inválido o inactivo.");

    const sucursal = await ctx.db.sucursal.findFirst({ where: { id: input.sucursalId, empresaId: ctx.empresaId }, select: { id: true } });
    if (!sucursal) return error("Sucursal inválida.");

    // `conPermiso` solo validó la sucursal ACTIVA: el alta apunta a la que eligió el formulario (viene del cliente), y ahí el
    // rol de quien la hace puede no tener `gestion_usuarios` (o no tener ni membresía).
    if (input.sucursalId !== ctx.sucursalId) {
      const gate = await requierePermiso(ctx.usuarioId, input.sucursalId, "gestion_usuarios", ctx.db);
      if (!gate.ok) return error(gate.mensaje);
    }
    const esAdminAhi = ctx.membresias.find((m) => m.sucursalId === input.sucursalId)?.rolNombre === "admin";

    const usuario = await ctx.db.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const existente = await ctx.db.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
      include: { rol: true },
    });

    if (!puedeTocarAdmins(ctx, esAdminAhi) && (rol.nombre === "admin" || existente?.rol.nombre === "admin")) {
      return error("Solo un admin o el gerente de la empresa puede dar el rol admin o modificar a un admin.");
    }

    // Salvaguarda: si esto le cambia el rol a la única persona admin activa
    // de todo el sistema, no dejarlo aplicar (Core.js:1159-1167 — "nunca
    // queda el sistema sin ningún admin activo", chequeo a nivel EMPRESA, no por
    // sucursal; hoy hay una sola empresa activa, ADR-007).
    if (existente?.activo && existente.rol.nombre === "admin" && rol.nombre !== "admin") {
      const quedan = await contarAdminsActivosExcluyendo(ctx.db, ctx.empresaId, existente.id);
      if (quedan === 0) {
        return error(
          "Esta operación dejaría el sistema sin ningún admin activo — no se puede aplicar. Dejá al menos un admin activo antes de cambiar este."
        );
      }
    }

    // Las dos pertenencias van juntas: sin la de empresa el usuario no tendría contexto (core/auth/contexto.ts).
    await ctx.db.usuarioEmpresa.upsert({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: ctx.empresaId } },
      update: { activo: true },
      create: { usuarioId: usuario.id, empresaId: ctx.empresaId },
    });
    await ctx.db.usuarioSucursal.upsert({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
      update: { rolId: rol.id, notas: input.notas, activo: true },
      create: { usuarioId: usuario.id, sucursalId: input.sucursalId, empresaId: ctx.empresaId, rolId: rol.id, notas: input.notas },
    });

    return ok(`Usuario "${email}" guardado en la sucursal.`);
  });
}

/** Equivalente de actualizarActivoUsuario (Core.js:1181-1211). */
export async function actualizarActivoMembresia(membresiaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const membresia = await ctx.db.usuarioSucursal.findUnique({
      where: { id: membresiaId },
      include: { rol: true },
    });
    if (!membresia || membresia.sucursalId !== ctx.sucursalId) return error("No se encontró esa membresía.");

    if (membresia.rol.nombre === "admin" && !puedeTocarAdmins(ctx, ctx.rolNombre === "admin")) {
      return error("Solo un admin o el gerente de la empresa puede modificar a un admin.");
    }
    if (!activo && membresia.rol.nombre === "admin") {
      const quedan = await contarAdminsActivosExcluyendo(ctx.db, ctx.empresaId, membresiaId);
      if (quedan === 0) {
        return error(
          "Esta operación dejaría el sistema sin ningún admin activo — no se puede desactivar. Activá otro admin antes."
        );
      }
    }

    await ctx.db.usuarioSucursal.update({ where: { id: membresiaId }, data: { activo } });
    return ok(`Usuario ${activo ? "activado" : "desactivado"}.`);
  });
}

/**
 * El campo "notas" de la membresía existía en el modelo (se llenaba solo
 * por flujos automáticos de bootstrap) pero no se podía ver ni editar
 * desde la UI — hallazgo de la auditoría de motor2.
 */
export async function actualizarNotasMembresia(membresiaId: string, notas: string): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const membresia = await ctx.db.usuarioSucursal.findUnique({ where: { id: membresiaId } });
    if (!membresia || membresia.sucursalId !== ctx.sucursalId) return error("No se encontró esa membresía.");

    await ctx.db.usuarioSucursal.update({ where: { id: membresiaId }, data: { notas: texto(notas) || null } });
    return ok("Notas actualizadas.");
  });
}

/**
 * Kill-switch de la cuenta EN ESTA EMPRESA (`UsuarioEmpresa.activo`) — a diferencia de actualizarActivoMembresia (una fila
 * UsuarioSucursal, una sucursal a la vez), corta el acceso a TODAS las sucursales de la empresa de una sola vez. La misma
 * persona puede seguir activa en otra empresa: `User.activoGlobal` (cuenta de toda la plataforma) no se toca desde acá, lo
 * decide la plataforma. El corte lo hace `obtenerContextoUsuario`, que solo arma contexto con la pertenencia activa.
 *
 * Mismo criterio "nunca sin ningún admin activo" que actualizarActivoMembresia (Core.js:1159-1167), a nivel empresa: desactivar
 * a alguien que es admin activo en CUALQUIER sucursal no puede dejar la empresa sin ningún admin activo.
 */
export async function actualizarActivoUsuarioEnEmpresa(usuarioId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    // `UsuarioEmpresa` y `User` no tienen RLS: sin el `empresaId` de la clave, el id de cualquier empresa se podía apagar.
    const pertenencia = await ctx.db.usuarioEmpresa.findUnique({
      where: { usuarioId_empresaId: { usuarioId, empresaId: ctx.empresaId } },
      include: { usuario: true },
    });
    if (!pertenencia) return error("No se encontró ese usuario.");
    const usuario = pertenencia.usuario;

    const esAdminActivo = await ctx.db.usuarioSucursal.findFirst({
      where: { empresaId: ctx.empresaId, usuarioId, activo: true, rol: { nombre: "admin", activo: true } },
    });
    if (esAdminActivo && !puedeTocarAdmins(ctx, ctx.rolNombre === "admin")) {
      return error("Solo un admin o el gerente de la empresa puede modificar a un admin.");
    }

    if (!activo && esAdminActivo) {
      const quedan = await ctx.db.usuarioSucursal.count({
        where: { empresaId: ctx.empresaId, activo: true, rol: { nombre: "admin", activo: true }, usuarioId: { not: usuarioId } },
      });
      if (quedan === 0) {
        return error("Esta operación dejaría la empresa sin ningún admin activo — no se puede desactivar. Activá otro admin antes.");
      }
    }

    await ctx.db.usuarioEmpresa.update({ where: { id: pertenencia.id }, data: { activo } });
    return ok(`Cuenta de "${usuario.email}" ${activo ? "reactivada" : "desactivada"} en la empresa.`);
  });
}
