"use server";

import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

async function contarAdminsActivosExcluyendo(idExcluido?: string): Promise<number> {
  return prisma.usuarioSucursal.count({
    where: {
      activo: true,
      rol: { nombre: "admin", activo: true },
      ...(idExcluido ? { id: { not: idExcluido } } : {}),
    },
  });
}

export async function listarUsuariosDeSucursal(sucursalId: string) {
  return prisma.usuarioSucursal.findMany({
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
  return conPermiso("gestion_usuarios", async () => {
    const email = texto(input.email).toLowerCase();
    if (!email) return error("El email es obligatorio.");

    const rol = await prisma.rol.findUnique({ where: { id: input.rolId } });
    if (!rol || !rol.activo) return error("Rol inválido o inactivo.");

    const usuario = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const existente = await prisma.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: input.sucursalId } },
      include: { rol: true },
    });

    // Salvaguarda: si esto le cambia el rol a la única persona admin activa
    // de todo el sistema, no dejarlo aplicar (Core.js:1159-1167 — "nunca
    // queda el sistema sin ningún admin activo", chequeo GLOBAL porque acá
    // es un solo negocio, no multi-tenant).
    if (existente?.activo && existente.rol.nombre === "admin" && rol.nombre !== "admin") {
      const quedan = await contarAdminsActivosExcluyendo(existente.id);
      if (quedan === 0) {
        return error(
          "Esta operación dejaría el sistema sin ningún admin activo — no se puede aplicar. Dejá al menos un admin activo antes de cambiar este."
        );
      }
    }

    await prisma.usuarioSucursal.upsert({
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
    const membresia = await prisma.usuarioSucursal.findUnique({
      where: { id: membresiaId },
      include: { rol: true },
    });
    if (!membresia || membresia.sucursalId !== ctx.sucursalId) return error("No se encontró esa membresía.");

    if (!activo && membresia.rol.nombre === "admin") {
      const quedan = await contarAdminsActivosExcluyendo(membresiaId);
      if (quedan === 0) {
        return error(
          "Esta operación dejaría el sistema sin ningún admin activo — no se puede desactivar. Activá otro admin antes."
        );
      }
    }

    await prisma.usuarioSucursal.update({ where: { id: membresiaId }, data: { activo } });
    return ok(`Usuario ${activo ? "activado" : "desactivado"}.`);
  });
}
