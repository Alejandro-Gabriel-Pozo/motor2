"use server";

import { cookies } from "next/headers";
import { RedirectType, redirect } from "next/navigation";
import { COOKIE_SUCURSAL_ACTIVA, obtenerContextoUsuario, opcionesCookieActiva } from "@/core/auth/contexto";
import { accionesDeNavegacion } from "@/core/navegacion/estructura";
import { pantallaTrasCambiarSucursal } from "@/core/navegacion/pantalla-tras-cambio";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";

/**
 * Cambia qué sucursal ve el usuario en esta sesión — solo entre las que YA
 * tiene como membresía activa (se verifica acá, no se confía en lo que
 * mande el cliente). No pasa por conPermiso: no es una mutación de datos
 * de negocio, es una preferencia personal sin riesgo de escalar privilegio
 * (ver docstring de obtenerContextoUsuario).
 *
 * `pantallaActual` (la ruta en la que estaba, la manda el selector) es entrada del usuario: no se usa como destino. Solo sirve para
 * elegir un ítem conocido del menú que el rol también ve en la sucursal NUEVA (`pantallaTrasCambiarSucursal`); si no hay, a la raíz.
 */
export async function cambiarSucursalActiva(sucursalId: string, pantallaActual?: string): Promise<void> {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return;

  // Solo entre las sucursales de la empresa activa (la cookie de otra empresa no valdría en `obtenerContextoUsuario`).
  const membresia = await ctx.db.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId: ctx.usuarioId, sucursalId } },
  });
  if (!membresia?.activo) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_SUCURSAL_ACTIVA, sucursalId, opcionesCookieActiva());

  // Lo que el rol puede ver en la sucursal NUEVA (la cookie recién escrita todavía no rige en este pedido).
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, sucursalId, accionesDeNavegacion(), ctx.db);
  // `replace`: en una Server Action `redirect` hace push por defecto y «Atrás» volvería a la pantalla de la sucursal anterior.
  redirect(pantallaTrasCambiarSucursal(pantallaActual, puedeVer) ?? "/", RedirectType.replace);
}
