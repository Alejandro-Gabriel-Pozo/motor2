import { obtenerContextoUsuario, type ContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { conAlcanceEnSucursal } from "@/server/acceso/alcance";
import { denegado, requierePermiso, requierePermisoDeEmpresa, type ResultadoGate } from "@/server/acceso/gate";
import { limitadorMutaciones } from "@/server/actions/limitador-de-mutaciones";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import type { AccionDeEmpresa, AccionDeSucursal } from "@/core/permisos/acciones";
import { error, type ContextoDeAccion, type ResultadoAccion } from "./tipos";

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
  fn: (ctx: ContextoDeAccion) => Promise<T>
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
  fn: (ctx: ContextoDeAccion) => Promise<T>
): Promise<T> {
  return conGate((ctx) => requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, accionClave, ctx.db), fn);
}

/**
 * Una acción de EMPRESA que exige DOS claves (un comando compuesto, Fase 6 «el espacio del producto», 6.14): la primera la pide el envoltorio (`conPermisoDeEmpresa("a", …)`) y la segunda va ACÁ, como
 * primera línea de la función que recibe, antes de formatear o escribir nada:
 *
 *   conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
 *     const tambien = await exigirTambienPermisoDeEmpresa(ctx, "opciones_definir");
 *     if (!tambien.ok) return error(tambien.mensaje);
 *     …
 *
 * Mismo gate que `conPermisoDeEmpresa` (`requierePermisoDeEmpresa`: membresía, rol, módulo y piso de nivel, con el mismo mensaje de denegación), así que NO es una clave nueva ni cambia quién puede qué:
 * pide por adelantado lo que hoy se pide en dos pantallas. La ficha del caso de uso la declara con `+` (`permiso=a+b`) y `test/arquitectura/ficha-de-caso-de-uso.test.ts` la lee del código: la literal de
 * la segunda clave tiene que estar escrita ahí adentro (una variable no se puede verificar y la ficha sale como mentira).
 */
export async function exigirTambienPermisoDeEmpresa(ctx: ContextoUsuario, accionClave: AccionDeEmpresa): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const gate = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, accionClave, ctx.db);
  return gate.ok ? { ok: true } : { ok: false, mensaje: gate.mensaje };
}

/**
 * Como `conPermisoDeEmpresa` para lo que EDITA los permisos de la empresa (la matriz de `PermisoRol` y el alta/activación de roles): además de
 * la clave, exige que la PLATAFORMA le deje a la empresa editar permisos (`politicaDeEmpresa`, el add-on de ADR-008). Primero se gatea la clave
 * (quien no tiene el permiso no se entera de la política) y después la política. Toda escritura de `PermisoRol`/`Rol` de `src/` pasa por
 * acá (guardián `escrituras-de-permisos-por-politica.test.ts`).
 */
export async function conEdicionDePermisos<T extends ResultadoAccion = ResultadoAccion>(
  accionClave: AccionDeEmpresa,
  fn: (ctx: ContextoDeAccion) => Promise<T>
): Promise<T> {
  return conGate(async (ctx) => {
    const gate = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, accionClave, ctx.db);
    if (!gate.ok) return gate;
    const politica = await politicaDeEmpresa(ctx.empresaId, ctx.db);
    return politica.permisosEditables ? { ok: true } : denegado({ motivo: "SIN_PERMISO", caso: "POLITICA_DE_PLATAFORMA" });
  }, fn);
}

/**
 * Para la acción que ya pasó `conPermiso` (el permiso en la sucursal ACTIVA) y además escribe en OTRA sucursal que le llegó por parámetro (forma `GATE_EN_ESA_SUCURSAL` de GT-4):
 * pide `accionClave` EN esa sucursal (`requierePermiso`, que mira membresía, rol, módulo y capacidad allí) y, SOLO si lo aprueba, devuelve el contexto con la LECTURA y la ESCRITURA
 * ensanchadas a ella (M.3-A4, `conAlcanceEnSucursal`); la acción sigue con ese contexto. Si no lo aprueba devuelve el mensaje del gate y el contexto original no se toca.
 */
export async function permisoYAlcanceEnSucursal<C extends ContextoUsuario>(ctx: C, sucursalId: string, accionClave: AccionDeSucursal): Promise<{ ok: true; ctx: C } | { ok: false; mensaje: string }> {
  const gate = await requierePermiso(ctx.usuarioId, sucursalId, accionClave, ctx.db);
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };
  return { ok: true, ctx: conAlcanceEnSucursal(ctx, sucursalId, "LECTURA_Y_ESCRITURA") };
}

async function conGate<T extends ResultadoAccion>(
  gatear: (ctx: ContextoUsuario) => Promise<ResultadoGate>,
  fn: (ctx: ContextoDeAccion) => Promise<T>
): Promise<T> {
  const ctx = await obtenerContextoUsuario();
  // Sin sesión (venció, o un admin desactivó al usuario con la pestaña abierta), sin ninguna sucursal activa, con la empresa suspendida o con
  // la empresa por elegir (dos o más y ninguna elegida): a diferencia
  // de un permiso denegado, que se le explica al usuario, acá no hay nada que corregir en la pantalla. Antes se devolvía
  // «No autenticado…» como un error más y el formulario seguía abierto; quien solo envía formularios nunca llegaba al
  // login. Ahora se lo lleva a /login, igual que hace el layout de (app) en cualquier navegación; esa pantalla ya explica
  // cada uno de esos casos. Se recuerda la pantalla en la que estaba para volver a
  // ella al entrar (`irAlLogin`). La redirección lanza, por eso va antes de todo.
  if (!ctx) return irAlLogin();

  // La hora del pedido se fija ACÁ, una sola vez (Pureza 1.2): el limitador, el dominio y los casos de uso la reciben, no leen el reloj.
  const ahora = new Date();
  if (limitadorMutaciones.excedeLimite(ctx.usuarioId, ahora.getTime())) {
    return error("Demasiadas acciones seguidas — esperá un minuto e intentá de nuevo.") as T;
  }

  const gate = await gatear(ctx);
  if (!gate.ok) return error(gate.mensaje) as T;

  return fn({ ...ctx, ahora });
}
