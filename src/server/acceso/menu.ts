import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { accionesDelMenuQueElUsuarioPuedeVer } from "@/server/acceso/gate";
import type { AccionClave } from "@/core/permisos/acciones";
import { PROCESOS_DEL_SELECTOR, type ProcesoDelSelector } from "@/core/movimientos/public";
import { GRUPOS_NAV, accionesDeNavegacion, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso, puedeVerItem, type GrupoNav } from "@/core/navegacion/estructura";
import type { PantallaDeStock } from "@/core/stock/public";
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

/**
 * Los procesos del selector «Registrar movimiento» que el rol puede VER en la sucursal activa, en el orden del selector: lo que dibuja la fila «Qué movimiento registrar». Se filtra acá, en el servidor, y al
 * navegador solo llega lo que se ofrece. `visibles` es el conjunto que la página ya calculó con su guarda (`requierePermisoVerDeAlguna`): si falta, se lee con el mismo cálculo del menú.
 */
export async function procesosVisiblesDelSelector(ctx: ContextoUsuario, visibles?: ReadonlySet<AccionClave>): Promise<ProcesoDelSelector[]> {
  const puedeVer = visibles ?? (await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, PROCESOS_DEL_SELECTOR.map((p) => p.accion), ctx.db));
  return PROCESOS_DEL_SELECTOR.filter((p) => puedeVer.has(p.accion));
}

/**
 * De una fila de pestañas de Stock (DEC-27: `PESTANAS_DE_EXISTENCIAS` o `PESTANAS_DE_CONFIGURACION`), las que el rol puede VER: una pestaña con `accion` si ve esa clave, una con `algunaDe` si ve alguna.
 * Cada clave se evalúa en su contexto (las de empresa en la empresa activa), con el mismo cálculo del menú. `visibles` es el conjunto que la página ya calculó con su guarda, si lo tiene.
 */
export async function pestanasVisiblesDeStock(ctx: ContextoUsuario, pestanas: readonly PantallaDeStock[], visibles?: ReadonlySet<AccionClave>): Promise<PantallaDeStock[]> {
  const claves = [...new Set(pestanas.flatMap((p) => (p.algunaDe ? [...p.algunaDe] : [p.accion])))];
  const puedeVer = visibles ?? (await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, claves, ctx.db));
  return pestanas.filter((p) => puedeVerItem(p, puedeVer));
}
