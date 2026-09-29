import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { baseDelContexto, type BaseDelContexto } from "./base";
import { getUsuarioActual } from "./session";

export const COOKIE_SUCURSAL_ACTIVA = "sucursalActivaId";
export const COOKIE_EMPRESA_ACTIVA = "empresaActivaId";

export interface MembresiaUsuario {
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
}

export interface EmpresaDelUsuario {
  empresaId: string;
  empresaSlug: string;
  empresaNombre: string;
  /** Rol del usuario en la empresa (`UsuarioEmpresa.rolEmpresa`); `null` = sin rol de empresa: acceso solo por sus sucursales. Texto libre, hoy solo se documenta "gerente". */
  rolEmpresa: string | null;
}

export interface ContextoUsuario extends BaseDelContexto {
  usuarioId: string;
  email: string;
  /** Empresa activa de la sesión: la de la cookie si el usuario pertenece a ella, si no la primera. La sucursal y `membresias` de abajo son SOLO de esta empresa. */
  empresaId: string;
  empresaSlug: string;
  empresaNombre: string;
  rolEmpresa: string | null;
  /** Empresas activas donde el usuario tiene `UsuarioEmpresa` y al menos una sucursal activa — para el selector de empresa (solo se muestra con más de una). */
  empresas: EmpresaDelUsuario[];
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
  /** Todas las sucursales activas de la empresa activa donde este usuario tiene membresía activa — para el selector de sucursal (ver src/components/selector-sucursal.tsx) cuando hay más de una. */
  membresias: MembresiaUsuario[];
}

/**
 * Empresa activa y sucursal activa (ADR-007, paso A4).
 *
 * Empresa: la elegida vía cookie (`cambiarEmpresaActiva`, src/server/actions/auth/empresa-activa.ts) si el usuario
 * tiene `UsuarioEmpresa` activo ahí (y la empresa está ACTIVE y tiene alguna sucursal suya activa), o si no la primera
 * por antigüedad de la pertenencia. Con UNA empresa (la instalación de hoy) no hay nada que elegir.
 *
 * Sucursal: la elegida vía cookie (`cambiarSucursalActiva`, src/server/actions/auth/sucursal-activa.ts) si el usuario
 * tiene membresía activa ahí (dentro de la empresa activa), o si no la primera membresía activa por antigüedad.
 *
 * Ninguna cookie se confía a ciegas: solo se usan si coinciden con una pertenencia real del usuario ya traída de la
 * base — así nadie puede "elegir" (vía cookie manipulada a mano) una empresa o sucursal a la que no pertenece.
 *
 * `UsuarioEmpresa` es la fuente de la pertenencia a la empresa: una membresía de sucursal SIN su `UsuarioEmpresa`
 * activo no da contexto (el bootstrap, `agregarOActualizarUsuario` y `crearSucursalConAdmin` crean las dos).
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

  const pertenencias = await prisma.usuarioEmpresa.findMany({
    where: { usuarioId: usuario.id, activo: true, empresa: { estado: "ACTIVE" } },
    include: { empresa: true },
    orderBy: { creadoEn: "asc" },
  });
  if (!pertenencias.length) return null;

  const membresiasTodas = await prisma.usuarioSucursal.findMany({
    where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true, empresaId: { in: pertenencias.map((p) => p.empresaId) } } },
    include: { sucursal: true, rol: true },
    orderBy: { creadoEn: "asc" },
  });
  const empresasConAcceso = pertenencias.filter((p) => membresiasTodas.some((m) => m.sucursal.empresaId === p.empresaId));
  if (!empresasConAcceso.length) return null;

  const cookieStore = await cookies();
  const empresaElegida = cookieStore.get(COOKIE_EMPRESA_ACTIVA)?.value;
  const empresaActiva = (empresaElegida && empresasConAcceso.find((p) => p.empresaId === empresaElegida)) || empresasConAcceso[0];

  const membresias = membresiasTodas.filter((m) => m.sucursal.empresaId === empresaActiva.empresaId);
  const sucursalElegida = cookieStore.get(COOKIE_SUCURSAL_ACTIVA)?.value;
  const activa = (sucursalElegida && membresias.find((m) => m.sucursalId === sucursalElegida)) || membresias[0];

  return {
    usuarioId: usuario.id,
    email: usuario.email,
    empresaId: empresaActiva.empresaId,
    empresaSlug: empresaActiva.empresa.slug,
    empresaNombre: empresaActiva.empresa.nombre,
    rolEmpresa: empresaActiva.rolEmpresa,
    empresas: empresasConAcceso.map((p) => ({ empresaId: p.empresaId, empresaSlug: p.empresa.slug, empresaNombre: p.empresa.nombre, rolEmpresa: p.rolEmpresa })),
    sucursalId: activa.sucursalId,
    sucursalNombre: activa.sucursal.nombre,
    rolNombre: activa.rol.nombre,
    membresias: membresias.map((m) => ({ sucursalId: m.sucursalId, sucursalNombre: m.sucursal.nombre, rolNombre: m.rol.nombre })),
    ...baseDelContexto(),
  };
});
