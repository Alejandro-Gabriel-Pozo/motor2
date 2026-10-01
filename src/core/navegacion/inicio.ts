import type { ContextoUsuario } from "@/core/auth/contexto";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/core/permisos/gate";
import { GRUPOS_NAV, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso } from "./estructura";

/** La pantalla a la que se manda al usuario al entrar: la primera que su rol puede abrir en la sucursal activa. */
export async function pantallaDeInicio(ctx: ContextoUsuario): Promise<string> {
  const puedeVer = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, accionesDelMenu(), ctx.db);
  return elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, puedeVer));
}
