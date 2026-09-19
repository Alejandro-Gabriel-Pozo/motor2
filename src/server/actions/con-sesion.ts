import { obtenerContextoUsuario, type ContextoUsuario } from "@/core/auth/contexto";
import type { AccionClave } from "@/core/permisos/acciones";
import { requierePermisoVer } from "@/core/permisos/gate";

/**
 * Guarda de las LECTURAS de servidor (server actions que devuelven datos y no pasan por `conPermiso`, que es el
 * envoltorio de las mutaciones). Una server action es un endpoint que se puede invocar directo, sin pasar por la
 * página que la usa: proteger solo la página deja la lectura abierta. Esta guarda exige, como primera línea de cada
 * lectura, una sesión con al menos una sucursal activa. Si no la hay, lanza: la llamada del cliente se rechaza.
 *
 * No es un archivo `"use server"` a propósito: así sus exports no se vuelven endpoints.
 */
export async function requerirSesion(): Promise<ContextoUsuario> {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) throw new Error("No autenticado, o tu usuario no tiene ninguna sucursal asignada.");
  return ctx;
}

/**
 * Además de la sesión, exige que el usuario tenga una membresía activa en `sucursalId`. Para las lecturas que reciben la
 * sucursal por parámetro (viene del cliente, no se puede confiar): sin esto, cualquier usuario logueado podría leer los
 * datos de una sucursal a la que no pertenece pasando su id.
 */
export async function requerirSesionEnSucursal(sucursalId: string): Promise<ContextoUsuario> {
  const ctx = await requerirSesion();
  if (!ctx.membresias.some((m) => m.sucursalId === sucursalId)) throw new Error("No tenés acceso a esa sucursal.");
  return ctx;
}

/**
 * Sesión + el permiso de «Ver» de la pantalla dueña de los datos. Para las lecturas que devuelven los datos PROPIOS de una
 * pantalla (los usuarios, los precios locales, el stock mínimo, la matriz de permisos…): la página ya pide ese permiso para
 * mostrarse, pero la lectura es un endpoint que se puede invocar directo, y con solo `requerirSesion` cualquier usuario logueado
 * la podía llamar aunque su rol no pudiera abrir la pantalla. La clave tiene que ser la MISMA que pide la página
 * (test/permisos/lecturas-con-permiso-de-ver.test.ts lo comprueba).
 *
 * No va en las lecturas de catálogo compartido (secciones, unidades, proveedores, buscador de productos…): se usan como
 * selectores en muchas pantallas con claves distintas y no tienen una pantalla dueña.
 *
 * Se evalúa en la sucursal activa, igual que la página. Lanza si no hay sesión o no hay permiso: la llamada del cliente se
 * rechaza y `useLeerServidor` refresca la pantalla, que muestra el mensaje de permiso.
 */
export async function requerirVer(accion: AccionClave): Promise<ContextoUsuario> {
  const ctx = await requerirSesion();
  await exigirVer(ctx.usuarioId, ctx.sucursalId, accion);
  return ctx;
}

/** Como `requerirVer` para las lecturas que reciben la sucursal por parámetro: además exige membresía activa en ella. */
export async function requerirVerEnSucursal(sucursalId: string, accion: AccionClave): Promise<ContextoUsuario> {
  const ctx = await requerirSesionEnSucursal(sucursalId);
  await exigirVer(ctx.usuarioId, sucursalId, accion);
  return ctx;
}

async function exigirVer(usuarioId: string, sucursalId: string, accion: AccionClave): Promise<void> {
  const gate = await requierePermisoVer(usuarioId, sucursalId, accion);
  if (!gate.ok) throw new Error(gate.mensaje);
}
