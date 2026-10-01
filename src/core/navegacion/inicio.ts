import type { ContextoUsuario } from "@/core/auth/contexto";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/core/permisos/gate";
import { GRUPOS_NAV, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso, type GrupoNav } from "./estructura";
import { tarjetasDeInicio, type TarjetaInicio } from "./tarjetas-inicio";

async function menuVisibleDe(ctx: ContextoUsuario): Promise<GrupoNav[]> {
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, accionesDelMenu(), ctx.db);
  return filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer);
}

/** La pantalla a la que se manda al usuario al entrar: `/inicio`, o el mapa de mesas si solo tiene el salón (ver `elegirPantallaDeInicio`). */
export async function pantallaDeInicio(ctx: ContextoUsuario): Promise<string> {
  return elegirPantallaDeInicio(await menuVisibleDe(ctx));
}

/** Las tarjetas de `/inicio`: un módulo por cada uno que el rol puede abrir en la sucursal activa. */
export async function tarjetasDelUsuario(ctx: ContextoUsuario): Promise<TarjetaInicio[]> {
  return tarjetasDeInicio(await menuVisibleDe(ctx));
}
