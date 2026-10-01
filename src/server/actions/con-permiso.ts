import { obtenerContextoUsuario, type ContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermiso, requierePermisoDeEmpresa, type ResultadoGate } from "@/core/permisos/gate";
import { limitadorMutaciones } from "@/core/permisos/limitador-tasa";
import { MENSAJE_PERMISOS_DE_PLATAFORMA, politicaDeEmpresa } from "@/core/permisos/politica-de-empresa";
import { esGerenteDeEmpresa } from "@/core/permisos/rol-empresa";
import type { AccionDeEmpresa, AccionDeSucursal } from "@/core/permisos/acciones";
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
  accionClave: AccionDeSucursal,
  fn: (ctx: ContextoUsuario) => Promise<T>
): Promise<T> {
  return conGate((ctx) => requierePermiso(ctx.usuarioId, ctx.sucursalId, accionClave, ctx.db), fn);
}

/**
 * Como `conPermiso` para una acción de CONTEXTO EMPRESA: el permiso vale si alguna de las membresías del usuario en la empresa activa lo tiene,
 * no solo la de la sucursal en la que está parado (ver `requierePermisoDeEmpresa`). La clave es del tipo estrecho `AccionDeEmpresa`: pasarle
 * una acción de sucursal no compila.
 */
export async function conPermisoDeEmpresa<T extends ResultadoAccion = ResultadoAccion>(
  accionClave: AccionDeEmpresa,
  fn: (ctx: ContextoUsuario) => Promise<T>
): Promise<T> {
  return conGate((ctx) => requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, accionClave, ctx.db), fn);
}

/**
 * Como `conPermisoDeEmpresa` para lo que EDITA los permisos de la empresa (la matriz de `PermisoRol` y el alta/activación de roles): además de
 * la clave, exige que la PLATAFORMA le deje a la empresa editar permisos (`politicaDeEmpresa`, el add-on de ADR-008). Primero se gatea la clave
 * (quien no tiene el permiso no se entera de la política) y después la política. Toda escritura de `PermisoRol`/`Rol` de `src/` pasa por
 * acá (guardián `escrituras-de-permisos-por-politica.test.ts`).
 */
export async function conEdicionDePermisos<T extends ResultadoAccion = ResultadoAccion>(
  accionClave: AccionDeEmpresa,
  fn: (ctx: ContextoUsuario) => Promise<T>
): Promise<T> {
  return conGate(async (ctx) => {
    const gate = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, accionClave, ctx.db);
    if (!gate.ok) return gate;
    const politica = await politicaDeEmpresa(ctx.empresaId, ctx.db);
    return politica.permisosEditables ? { ok: true } : { ok: false, mensaje: MENSAJE_PERMISOS_DE_PLATAFORMA };
  }, fn);
}

/**
 * Como `conPermisoDeEmpresa` para lo que SOLO hace el gerente de la empresa y no se delega por matriz (`UsuarioEmpresa.rolEmpresa`):
 * traspasar la gerencia. Las acciones de piso gerente del catálogo usan `conPermisoDeEmpresa`, que ya aplica el mismo criterio.
 */
export async function conGerenteDeEmpresa<T extends ResultadoAccion = ResultadoAccion>(fn: (ctx: ContextoUsuario) => Promise<T>): Promise<T> {
  return conGate(
    async (ctx) => (esGerenteDeEmpresa(ctx.rolEmpresa) ? { ok: true } : { ok: false, mensaje: "Solo el gerente de la empresa puede hacer esto." }),
    fn,
  );
}

async function conGate<T extends ResultadoAccion>(
  gatear: (ctx: ContextoUsuario) => Promise<ResultadoGate>,
  fn: (ctx: ContextoUsuario) => Promise<T>
): Promise<T> {
  const ctx = await obtenerContextoUsuario();
  // Sin sesión (venció, o un admin desactivó al usuario con la pestaña abierta) o sin ninguna sucursal activa: a diferencia
  // de un permiso denegado, que se le explica al usuario, acá no hay nada que corregir en la pantalla. Antes se devolvía
  // «No autenticado…» como un error más y el formulario seguía abierto; quien solo envía formularios nunca llegaba al
  // login. Ahora se lo lleva a /login, igual que hace el layout de (app) en cualquier navegación; esa pantalla ya explica
  // el caso «iniciaste sesión pero no tenés acceso a ninguna sucursal». Se recuerda la pantalla en la que estaba para volver a
  // ella al entrar (`irAlLogin`). La redirección lanza, por eso va antes de todo.
  if (!ctx) return irAlLogin();

  if (limitadorMutaciones.excedeLimite(ctx.usuarioId)) {
    return error("Demasiadas acciones seguidas — esperá un minuto e intentá de nuevo.") as T;
  }

  const gate = await gatear(ctx);
  if (!gate.ok) return error(gate.mensaje) as T;

  return fn(ctx);
}
