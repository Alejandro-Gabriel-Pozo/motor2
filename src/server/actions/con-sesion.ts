import { obtenerContextoUsuario, type ContextoUsuario } from "@/core/auth/contexto";

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
