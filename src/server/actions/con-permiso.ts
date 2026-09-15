import { obtenerContextoUsuario, type ContextoUsuario } from "@/core/auth/contexto";
import { requierePermiso } from "@/core/permisos/gate";
import type { AccionClave } from "@/core/permisos/acciones";
import { error, type ResultadoAccion } from "./tipos";

/**
 * Envoltorio obligatorio para toda mutación (server action): resuelve la
 * sesión, gatea con requierePermiso(accionClave) como PRIMERA línea, y solo
 * entonces ejecuta `fn`. Punto de enganche único — evitar repetir el gate a
 * mano en cada action es exactamente lo que impide el bug C-3 (una segunda
 * copia de la regla de permisos que diverge de la primera; ver plan,
 * "Gates de permiso").
 */
export async function conPermiso<T extends ResultadoAccion = ResultadoAccion>(
  accionClave: AccionClave,
  fn: (ctx: ContextoUsuario) => Promise<T>
): Promise<T> {
  const ctx = await obtenerContextoUsuario();
  // El cast es seguro: por convención, todo ResultadoAccion (y sus
  // variantes con datos extra, ej. ResultadoConId) comparte exactamente
  // la misma rama `{ ok: false; mensaje: string }` — T solo agrega campos
  // a la rama `ok: true`, nunca a la de error.
  if (!ctx) return error("No autenticado, o tu usuario no tiene ninguna sucursal asignada.") as T;

  const gate = await requierePermiso(ctx.usuarioId, ctx.sucursalId, accionClave);
  if (!gate.ok) return error(gate.mensaje) as T;

  return fn(ctx);
}
