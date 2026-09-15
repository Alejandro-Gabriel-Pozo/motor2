import "server-only";
import { prisma } from "@/lib/db";
import { getUsuarioActual } from "./session";

export interface ContextoUsuario {
  usuarioId: string;
  email: string;
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
}

/**
 * MVP de "sucursal activa": la primera membresía activa del usuario
 * (ordenada por antigüedad). La UI de selección explícita para alguien con
 * más de una sucursal queda fuera de esta porción — ver plan, "Fuera de
 * esta porción".
 */
export async function obtenerContextoUsuario(): Promise<ContextoUsuario | null> {
  const usuario = await getUsuarioActual();
  if (!usuario) return null;

  const membresia = await prisma.usuarioSucursal.findFirst({
    where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true } },
    include: { sucursal: true, rol: true },
    orderBy: { creadoEn: "asc" },
  });
  if (!membresia) return null;

  return {
    usuarioId: usuario.id,
    email: usuario.email,
    sucursalId: membresia.sucursalId,
    sucursalNombre: membresia.sucursal.nombre,
    rolNombre: membresia.rol.nombre,
  };
}
