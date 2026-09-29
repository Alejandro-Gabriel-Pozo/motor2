"use server";

import type { Db } from "@/lib/db-tipos";
import { texto } from "@/core/texto";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

async function contarAdminsActivosExcluyendo(db: Db, idExcluido?: string): Promise<number> {
  return db.usuarioSucursal.count({
    where: {
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

    const rol = await ctx.db.rol.findUnique({ where: { id: input.rolId } });
    if (!rol || !rol.activo) return error("Rol inválido o inactivo.");

    const usuario = await ctx.db.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const existente = await ctx.db.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
      include: { rol: true },
    });

    // Salvaguarda: si esto le cambia el rol a la única persona admin activa
    // de todo el sistema, no dejarlo aplicar (Core.js:1159-1167 — "nunca
    // queda el sistema sin ningún admin activo", chequeo GLOBAL porque acá
    // es un solo negocio, no multi-tenant).
    if (existente?.activo && existente.rol.nombre === "admin" && rol.nombre !== "admin") {
      const quedan = await contarAdminsActivosExcluyendo(ctx.db, existente.id);
      if (quedan === 0) {
        return error(
          "Esta operación dejaría el sistema sin ningún admin activo — no se puede aplicar. Dejá al menos un admin activo antes de cambiar este."
        );
      }
    }

    await ctx.db.usuarioSucursal.upsert({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
      update: { rolId: rol.id, notas: input.notas, activo: true },
      create: { usuarioId: usuario.id, sucursalId: input.sucursalId, rolId: rol.id, notas: input.notas },
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

    if (!activo && membresia.rol.nombre === "admin") {
      const quedan = await contarAdminsActivosExcluyendo(ctx.db, membresiaId);
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
 * Kill-switch de cuenta a nivel sistema (User.activoGlobal) — a diferencia
 * de actualizarActivoMembresia (una fila UsuarioSucursal, una sucursal a
 * la vez), esto corta el acceso en TODAS las sucursales de una sola vez,
 * sin tener que desactivar cada membresía por separado. Ver el gate real
 * en src/core/auth/acceso.ts (login nuevo) y el callback `session` de
 * src/lib/auth.ts (sesión ya abierta, corta en la próxima request).
 *
 * Mismo criterio "nunca sin ningún admin activo" que actualizarActivoMembresia
 * (Core.js:1159-1167), pero a nivel cuenta completa: desactivar a alguien
 * que es admin activo en CUALQUIER sucursal no puede dejar el sistema sin
 * ningún admin activo en ninguna.
 */
export async function actualizarActivoGlobalUsuario(usuarioId: string, activoGlobal: boolean): Promise<ResultadoAccion> {
  return conPermiso("gestion_usuarios", async (ctx) => {
    const usuario = await ctx.db.user.findUnique({ where: { id: usuarioId } });
    if (!usuario) return error("No se encontró ese usuario.");

    if (!activoGlobal) {
      const esAdminActivo = await ctx.db.usuarioSucursal.findFirst({
        where: { usuarioId, activo: true, rol: { nombre: "admin", activo: true } },
      });
      if (esAdminActivo) {
        const quedan = await ctx.db.usuarioSucursal.count({
          where: { activo: true, rol: { nombre: "admin", activo: true }, usuarioId: { not: usuarioId } },
        });
        if (quedan === 0) {
          return error(
            "Esta operación dejaría el sistema sin ningún admin activo — no se puede desactivar. Activá otro admin antes."
          );
        }
      }
    }

    await ctx.db.user.update({ where: { id: usuarioId }, data: { activoGlobal } });
    return ok(`Cuenta de "${usuario.email}" ${activoGlobal ? "reactivada" : "desactivada"} a nivel sistema.`);
  });
}
