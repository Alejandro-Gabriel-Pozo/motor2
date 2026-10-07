import { obtenerContextoUsuario, type ContextoUsuario } from "@/core/auth/contexto";
import { contextoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "@/core/permisos/acciones";
import { accionesDelMenuQueElUsuarioPuedeVer, requierePermisoVer, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";

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
 * Sesión + el permiso de «Ver» de la pantalla dueña de los datos. Para las lecturas que consume UNA sola pantalla, o varias con la
 * misma clave (los usuarios, los precios locales, el stock mínimo, la matriz de permisos…): la página ya pide ese permiso para
 * mostrarse, pero la lectura es un endpoint que se puede invocar directo, y con solo la sesión cualquier usuario logueado la podía
 * llamar aunque su rol no pudiera abrir la pantalla. La clave tiene que ser la MISMA que pide la página
 * (test/permisos/lecturas-con-permiso-de-ver.test.ts lo comprueba).
 *
 * Las lecturas que consumen pantallas con claves DISTINTAS (secciones, unidades, proveedores para elegir, buscador de productos…)
 * usan `requerirVerAlguna`: el «O» de las claves de esas pantallas (H8, decisión D-1 del dueño). Ninguna lectura queda con solo
 * sesión (lo vigila test/arquitectura/lecturas-con-sesion-lista-cerrada.test.ts).
 *
 * Se evalúa en la sucursal activa, igual que la página. Lanza si no hay sesión o no hay permiso: la llamada del cliente se
 * rechaza y `useLeerServidor` refresca la pantalla, que muestra el mensaje de permiso.
 */
export async function requerirVer(accion: AccionDeSucursal): Promise<ContextoUsuario> {
  const ctx = await requerirSesion();
  await exigirVer(ctx, ctx.sucursalId, accion);
  return ctx;
}

/** Como `requerirVer` para las lecturas que reciben la sucursal por parámetro: además exige membresía activa en ella. */
export async function requerirVerEnSucursal(sucursalId: string, accion: AccionDeSucursal): Promise<ContextoUsuario> {
  const ctx = await requerirSesionEnSucursal(sucursalId);
  await exigirVer(ctx, sucursalId, accion);
  return ctx;
}

/** Como `requerirVer` para una acción de CONTEXTO EMPRESA: alcanza con que alguna membresía del usuario en la empresa activa tenga el «Ver» (ver `requierePermisoVerDeEmpresa`). */
export async function requerirVerDeEmpresa(accion: AccionDeEmpresa): Promise<ContextoUsuario> {
  const ctx = await requerirSesion();
  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, accion, ctx.db);
  if (!gate.ok) throw new Error(gate.mensaje);
  return ctx;
}

/** Al menos una clave: una lista vacía no protegería nada (el tipo lo impide al compilar; `exigirVerAlguna` lo vuelve a mirar en ejecución). */
type ClavesDeLasPantallas = readonly [AccionClave, ...AccionClave[]];

/**
 * Sesión + el «Ver» de ALGUNA de las pantallas que consumen la lectura (H8, decisión D-1 del dueño, `docs/plan-hito-3-pureza.md` §5). Para las lecturas
 * que consumen pantallas con claves distintas (el buscador de productos, las unidades, los proveedores para elegir…): quien puede abrir cualquiera de esas
 * pantallas puede leer; quien no puede abrir ninguna, no. Las claves van como arreglo LITERAL en cada llamada, para que el inventario por AST las vea
 * (`test/arquitectura/guardas/inventario.ts`), y son exactamente las de las pantallas consumidoras
 * (`test/arquitectura/consumidores-de-lecturas-declarados.test.ts`).
 *
 * Cada clave se evalúa en su contexto, igual que la página que la pide: las de sucursal en la sucursal activa y las de empresa en la empresa activa
 * (`accionesDelMenuQueElUsuarioPuedeVer`, el mismo cálculo del menú, que coincide con el gate de cada página). Falla cerrado: sin ninguna clave visible
 * lanza el motivo de la PRIMERA (módulo apagado, capacidad o permiso).
 */
export async function requerirVerAlguna(claves: ClavesDeLasPantallas): Promise<ContextoUsuario> {
  const ctx = await requerirSesion();
  await exigirVerAlguna(ctx, ctx.sucursalId, claves);
  return ctx;
}

async function exigirVer(ctx: ContextoUsuario, sucursalId: string, accion: AccionDeSucursal): Promise<void> {
  const gate = await requierePermisoVer(ctx.usuarioId, sucursalId, accion, ctx.db);
  if (!gate.ok) throw new Error(gate.mensaje);
}

/** Lo que se lanza si el cálculo del menú no ve ninguna clave pero el gate de la primera dice que sí (no debería pasar: los dos salen de la misma decisión pura). */
const SIN_NINGUNA_PANTALLA = "No tenés permiso para ver esta sección.";

async function exigirVerAlguna(ctx: ContextoUsuario, sucursalId: string, claves: readonly AccionClave[]): Promise<void> {
  if (claves.length === 0) throw new Error(SIN_NINGUNA_PANTALLA);
  const visibles = await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, sucursalId, claves, ctx.db);
  if (claves.some((clave) => visibles.has(clave))) return;
  // Ninguna: el porqué es el del gate de la primera clave (el mismo texto que mostraría su página). Si ese gate dijera que sí, se rechaza igual.
  const primera = claves[0];
  const gate =
    contextoDeAccion(primera) === "empresa"
      ? await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, primera as AccionDeEmpresa, ctx.db)
      : await requierePermisoVer(ctx.usuarioId, sucursalId, primera as AccionDeSucursal, ctx.db);
  throw new Error(gate.ok ? SIN_NINGUNA_PANTALLA : gate.mensaje);
}
