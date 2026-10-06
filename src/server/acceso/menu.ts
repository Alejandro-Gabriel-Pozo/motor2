import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";
import type { AccionClave } from "@/core/permisos/acciones";
import { GRUPOS_NAV, accionesDeNavegacion, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso, type GrupoNav } from "@/core/navegacion/estructura";
import { tarjetasDeInicio, type TarjetaInicio } from "@/core/navegacion/tarjetas-inicio";

async function menuVisibleDe(ctx: ContextoUsuario): Promise<GrupoNav[]> {
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, accionesDelMenu(), ctx.db);
  return filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer);
}

/** La pantalla a la que se manda al usuario al entrar: `/inicio`, o el mapa de mesas si solo tiene el salón (ver `elegirPantallaDeInicio`). */
export async function pantallaDeInicio(ctx: ContextoUsuario): Promise<string> {
  return elegirPantallaDeInicio(await menuVisibleDe(ctx));
}

/**
 * Para el encabezado del salón: la pantalla de inicio del usuario y las acciones de navegación que puede ver en la sucursal activa
 * (con una sola consulta), que `EnlaceAdministracion` necesita para decidir si la última pantalla de gestión sigue siendo abrible.
 */
export async function navegacionDelUsuario(ctx: ContextoUsuario): Promise<{ inicio: string; acciones: AccionClave[] }> {
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, accionesDeNavegacion(), ctx.db);
  return { inicio: elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer)), acciones: [...puedeVer] };
}

/** Las tarjetas de `/inicio`: un módulo por cada uno que el rol puede abrir en la sucursal activa. */
export async function tarjetasDelUsuario(ctx: ContextoUsuario): Promise<TarjetaInicio[]> {
  return tarjetasDeInicio(await menuVisibleDe(ctx));
}
