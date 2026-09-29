import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { baseDelContexto, type BaseDelContexto } from "./base";
import { getUsuarioActual } from "./session";

export const COOKIE_SUCURSAL_ACTIVA = "sucursalActivaId";

export interface MembresiaUsuario {
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
}

export interface ContextoUsuario extends BaseDelContexto {
  usuarioId: string;
  email: string;
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
  /** Todas las sucursales activas donde este usuario tiene membresía activa — para el selector de sucursal (ver src/components/selector-sucursal.tsx) cuando hay más de una. */
  membresias: MembresiaUsuario[];
}

/**
 * "Sucursal activa": la elegida vía cookie (`cambiarSucursalActiva`,
 * src/server/actions/sucursal-activa.ts) si el usuario tiene membresía
 * activa ahí, o si no la primera membresía activa por antigüedad (mismo
 * MVP de antes, ahora con selector real para quien tiene más de una — ver
 * plan, "Fuera de esta porción", ya no aplica).
 *
 * La cookie NUNCA se confía a ciegas: solo se usa si coincide con una de
 * las membresías reales del usuario ya traídas de la base — así alguien
 * no puede "elegir" (vía cookie manipulada a mano) una sucursal a la que
 * no pertenece.
 *
 * `cache()` de React: esta función se llama en casi todo layout Y su page
 * (49+ call sites) — sin dedupear por request, cada navegación paga la
 * consulta de membresía tantas veces como componentes la llamen, encima
 * del round-trip que ya dedupea `getUsuarioActual`. Ver el mismo
 * comentario ahí.
 */
export const obtenerContextoUsuario = cache(async (): Promise<ContextoUsuario | null> => {
  const usuario = await getUsuarioActual();
  if (!usuario) return null;

  const membresias = await prisma.usuarioSucursal.findMany({
    where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true } },
    include: { sucursal: true, rol: true },
    orderBy: { creadoEn: "asc" },
  });
  if (!membresias.length) return null;

  const cookieStore = await cookies();
  const sucursalElegida = cookieStore.get(COOKIE_SUCURSAL_ACTIVA)?.value;
  const activa = (sucursalElegida && membresias.find((m) => m.sucursalId === sucursalElegida)) || membresias[0];

  return {
    usuarioId: usuario.id,
    email: usuario.email,
    sucursalId: activa.sucursalId,
    sucursalNombre: activa.sucursal.nombre,
    rolNombre: activa.rol.nombre,
    membresias: membresias.map((m) => ({ sucursalId: m.sucursalId, sucursalNombre: m.sucursal.nombre, rolNombre: m.rol.nombre })),
    ...baseDelContexto(),
  };
});
