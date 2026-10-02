"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { baseDeEmpresa } from "@/core/auth/base";
import { getUsuarioActual } from "@/core/auth/session";
import { COOKIE_EMPRESA_ACTIVA, COOKIE_SUCURSAL_ACTIVA, opcionesCookieActiva } from "@/core/auth/contexto";

/**
 * Cambia en qué empresa trabaja el usuario en esta sesión (ADR-007, A4) — solo entre las que YA tiene como pertenencia
 * activa (`UsuarioEmpresa`), con la empresa ACTIVE y al menos una sucursal suya activa: se verifica acá, no se confía en lo
 * que mande el cliente. Como `cambiarSucursalActiva`, no pasa por conPermiso: es una preferencia personal sin riesgo de
 * escalar privilegio (`obtenerContextoUsuario` vuelve a validar la cookie en cada pedido).
 *
 * Se borra la cookie de sucursal: era una sucursal de la empresa anterior y no puede valer en la nueva.
 */
export async function cambiarEmpresaActiva(empresaId: string): Promise<void> {
  const usuario = await getUsuarioActual();
  if (!usuario) return;

  // Ambas lecturas son de la empresa pedida: con RLS, su `app.empresa_id` es lo único que deja verlas.
  const { db } = baseDeEmpresa(empresaId);
  const pertenencia = await db.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId } },
    include: { empresa: true },
  });
  if (!pertenencia?.activo || pertenencia.empresa.estado !== "ACTIVE") return;

  const conSucursal = await db.usuarioSucursal.findFirst({
    where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true, empresaId } },
    select: { id: true },
  });
  if (!conSucursal) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_EMPRESA_ACTIVA, empresaId, opcionesCookieActiva());
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);

  redirect("/");
}
