import "server-only";
import { cache } from "react";
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
 *
 * `cache()` de React: esta función se llama en casi todo layout Y su page
 * (49 call sites) — sin dedupear por request, cada navegación paga la
 * consulta de membresía (`usuarioSucursal.findFirst`) tantas veces como
 * componentes la llamen, encima del round-trip que ya dedupea
 * `getUsuarioActual`. Ver el mismo comentario ahí.
 */
export const obtenerContextoUsuario = cache(async (): Promise<ContextoUsuario | null> => {
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
});
