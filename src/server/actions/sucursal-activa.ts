"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUsuarioActual } from "@/core/auth/session";
import { COOKIE_SUCURSAL_ACTIVA } from "@/core/auth/contexto";

/**
 * Cambia qué sucursal ve el usuario en esta sesión — solo entre las que YA
 * tiene como membresía activa (se verifica acá, no se confía en lo que
 * mande el cliente). No pasa por conPermiso: no es una mutación de datos
 * de negocio, es una preferencia personal sin riesgo de escalar privilegio
 * (ver docstring de obtenerContextoUsuario).
 */
export async function cambiarSucursalActiva(sucursalId: string): Promise<void> {
  const usuario = await getUsuarioActual();
  if (!usuario) return;

  const membresia = await prisma.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId } },
  });
  if (!membresia?.activo) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_SUCURSAL_ACTIVA, sucursalId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/");
}
