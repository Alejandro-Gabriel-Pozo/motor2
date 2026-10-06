import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { baseDeEmpresa, dbDeEmpresa, dbDeUsuario, verificarRolDeEjecucionDelProceso, type BaseDelContexto } from "./base";
import { esRolAdmin } from "@/core/permisos/jerarquia";
import { getUsuarioActual } from "./session";

export const COOKIE_SUCURSAL_ACTIVA = "sucursalActivaId";
export const COOKIE_EMPRESA_ACTIVA = "empresaActivaId";

/** Opciones de las cookies de empresa y sucursal activas: `secure` en producción para que nunca viajen por http. */
export function opcionesCookieActiva() {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" };
}

export interface MembresiaUsuario {
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
  /** El rol de esta membresía es el administrador (por su clave, no por su nombre). Lo que se decide con esto vive en `core/permisos/jerarquia.ts`. */
  esAdmin: boolean;
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
  /** Zona horaria IANA de la empresa activa (`Empresa.zonaHoraria`): la de las horas que se muestran y los días que se cortan. */
  empresaZonaHoraria: string;
  rolEmpresa: string | null;
  /** Empresas activas donde el usuario tiene `UsuarioEmpresa` y al menos una sucursal activa — para el selector de empresa (solo se muestra con más de una). */
  empresas: EmpresaDelUsuario[];
  sucursalId: string;
  sucursalNombre: string;
  rolNombre: string;
  /** Es administrador en la sucursal activa (por la clave de su rol). */
  esAdminEnSucursal: boolean;
  /** Todas las sucursales activas de la empresa activa donde este usuario tiene membresía activa — para el selector de sucursal (ver src/components/selector-sucursal.tsx) cuando hay más de una. */
  membresias: MembresiaUsuario[];
}

/**
 * En qué punto está el acceso de quien tiene sesión (ADR-007, A4 + E1). Un estado por pantalla final: quien lo consume
 * (`/login`, `obtenerContextoUsuario`) decide qué mostrar sin volver a consultar nada.
 *
 * - `CON_EMPRESA`: hay una empresa activa resuelta; `ctx` es el contexto completo.
 * - `ELEGIR_EMPRESA`: tiene acceso a DOS o más empresas activas y todavía no eligió una (no hay cookie, o la cookie no
 *   corresponde a ninguna de sus empresas): no se opera en ninguna por defecto.
 * - `EMPRESA_SUSPENDIDA`: no tiene ninguna empresa activa con acceso, pero sí pertenencia a una o más suspendidas.
 * - `EMPRESA_EN_ALTA` (E5, ADR-020): no tiene empresa activa ni suspendida, pero sí pertenencia a una o más que la plataforma todavía está dando de
 *   alta (`PROVISIONING`): aceptó su invitación y falta que la plataforma confirme el CUIT.
 * - `SIN_ACCESO`: ninguna pertenencia utilizable (incluye empresas en baja).
 */
export type SituacionDeAcceso =
  | { estado: "SIN_SESION" }
  | { estado: "CON_EMPRESA"; ctx: ContextoUsuario }
  | { estado: "ELEGIR_EMPRESA"; email: string; empresas: EmpresaDelUsuario[] }
  | { estado: "EMPRESA_SUSPENDIDA"; email: string; nombres: string[] }
  | { estado: "EMPRESA_EN_ALTA"; email: string; nombres: string[] }
  | { estado: "SIN_ACCESO"; email: string };

/**
 * Empresa activa y sucursal activa (ADR-007, paso A4).
 *
 * Empresa: la elegida vía cookie (`cambiarEmpresaActiva`, src/server/actions/auth/empresa-activa.ts) si el usuario
 * tiene `UsuarioEmpresa` activo ahí (y la empresa está ACTIVE y tiene alguna sucursal suya activa). Con UNA sola empresa
 * con acceso (la instalación de hoy) no hay nada que elegir y se entra directo; con DOS o más y sin cookie válida el
 * estado es `ELEGIR_EMPRESA` (pantalla de elección en `/login`): nunca se asume una por defecto.
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
export const obtenerSituacionDeAcceso = cache(async (): Promise<SituacionDeAcceso> => {
  const usuario = await getUsuarioActual();
  if (!usuario) return { estado: "SIN_SESION" };

  await verificarRolDeEjecucionDelProceso();

  const todas = await dbDeUsuario(usuario.id).usuarioEmpresa.findMany({
    where: { usuarioId: usuario.id, activo: true },
    include: { empresa: true },
    orderBy: { creadoEn: "asc" },
  });
  const pertenencias = todas.filter((p) => p.empresa.estado === "ACTIVE");
  const sinAcceso = (): SituacionDeAcceso => {
    const suspendidas = todas.filter((p) => p.empresa.estado === "SUSPENDED");
    if (suspendidas.length) return { estado: "EMPRESA_SUSPENDIDA", email: usuario.email, nombres: suspendidas.map((p) => p.empresa.nombre) };
    const enAlta = todas.filter((p) => p.empresa.estado === "PROVISIONING");
    return enAlta.length ? { estado: "EMPRESA_EN_ALTA", email: usuario.email, nombres: enAlta.map((p) => p.empresa.nombre) } : { estado: "SIN_ACCESO", email: usuario.email };
  };
  if (!pertenencias.length) return sinAcceso();

  // `Empresa` no tiene RLS; `UsuarioEmpresa` sí, y la lectura de arriba va con `dbDeUsuario` (sus pertenencias propias, aún sin empresa). `UsuarioSucursal` también tiene RLS: se lee una vez
  // por empresa del usuario, cada una bajo su propio contexto (`dbDeEmpresa`), no en una consulta cruzada.
  const membresiasTodas = (
    await Promise.all(
      pertenencias.map((p) =>
        dbDeEmpresa(p.empresaId).usuarioSucursal.findMany({
          where: { usuarioId: usuario.id, activo: true, sucursal: { activo: true, empresaId: p.empresaId } },
          include: { sucursal: true, rol: true },
          orderBy: { creadoEn: "asc" },
        })
      )
    )
  ).flat();
  const empresasConAcceso = pertenencias.filter((p) => membresiasTodas.some((m) => m.sucursal.empresaId === p.empresaId));
  if (!empresasConAcceso.length) return sinAcceso();

  const empresas: EmpresaDelUsuario[] = empresasConAcceso.map((p) => ({ empresaId: p.empresaId, empresaSlug: p.empresa.slug, empresaNombre: p.empresa.nombre, rolEmpresa: p.rolEmpresa }));

  const cookieStore = await cookies();
  const empresaElegida = cookieStore.get(COOKIE_EMPRESA_ACTIVA)?.value;
  const empresaDeLaCookie = empresaElegida ? empresasConAcceso.find((p) => p.empresaId === empresaElegida) : undefined;
  if (!empresaDeLaCookie && empresasConAcceso.length > 1) return { estado: "ELEGIR_EMPRESA", email: usuario.email, empresas };
  const empresaActiva = empresaDeLaCookie ?? empresasConAcceso[0];

  const membresias = membresiasTodas.filter((m) => m.sucursal.empresaId === empresaActiva.empresaId);
  const sucursalElegida = cookieStore.get(COOKIE_SUCURSAL_ACTIVA)?.value;
  const activa = (sucursalElegida && membresias.find((m) => m.sucursalId === sucursalElegida)) || membresias[0];

  return {
    estado: "CON_EMPRESA",
    ctx: {
      usuarioId: usuario.id,
      email: usuario.email,
      empresaId: empresaActiva.empresaId,
      empresaSlug: empresaActiva.empresa.slug,
      empresaNombre: empresaActiva.empresa.nombre,
      empresaZonaHoraria: empresaActiva.empresa.zonaHoraria,
      rolEmpresa: empresaActiva.rolEmpresa,
      empresas,
      sucursalId: activa.sucursalId,
      sucursalNombre: activa.sucursal.nombre,
      rolNombre: activa.rol.nombre,
      esAdminEnSucursal: esRolAdmin(activa.rol),
      membresias: membresias.map((m) => ({ sucursalId: m.sucursalId, sucursalNombre: m.sucursal.nombre, rolNombre: m.rol.nombre, esAdmin: esRolAdmin(m.rol) })),
      ...baseDeEmpresa(empresaActiva.empresaId),
    },
  };
});

/**
 * El contexto del usuario, o `null` si no puede operar en una empresa: sin sesión, sin acceso, con la empresa suspendida
 * o con la empresa por elegir. Falla cerrado: sin empresa elegida ninguna acción ni lectura opera en una por defecto.
 * Para saber POR QUÉ es `null` (y mostrarlo), `obtenerSituacionDeAcceso`.
 */
export const obtenerContextoUsuario = cache(async (): Promise<ContextoUsuario | null> => {
  const situacion = await obtenerSituacionDeAcceso();
  return situacion.estado === "CON_EMPRESA" ? situacion.ctx : null;
});
