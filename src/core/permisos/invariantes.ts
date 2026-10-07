import type { Db } from "@/lib/db-tipos";
import { filtroAdminEfectivo, filtroDelGerente } from "./filtros";

/**
 * Bloque G, G2: las invariantes de gobierno de una empresa, con nombre y en un solo lugar. Toda acción que cambie usuarios, roles o sucursales las
 * hace cumplir DENTRO de la misma transacción que la escritura (serializable, con reintento: `conTransaccionSerializable`), y sin ningún efecto
 * externo adentro (un mail, por ejemplo, va después del commit: el bloque puede reintentarse).
 *
 *   (a) la empresa siempre conserva un administrador efectivo;
 *   (b) el gerente siempre conserva una membresía activa en una sucursal activa;
 *   (c) un rol de sistema (con clave) no se desactiva, no se borra, no cambia de clave;
 *   (d) las acciones de gobierno de accesos siempre conservan al administrador entre sus roles de Editar (`ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`,
 *       `esCeldaFija` en matriz.ts);
 *   (e) un rol con usuarios activos no se desactiva;
 *   (f) (decisión Q1) el gerente es administrador efectivo en al menos una sucursal: para dejar de serlo, primero traspasa la gerencia.
 *
 * (a), (b) y (f) se miden sobre el ESTADO: `conInvariantesDeGobierno` mide antes y después de la escritura y rechaza el cambio que EMPEORA una de
 * ellas (estaba bien y queda mal). Una empresa que ya estaba mal no queda trabada: puede arreglarse, y lo que no puede es empeorar.
 */

export const MENSAJE_SIN_ADMIN_ACTIVO = "Esta operación dejaría el sistema sin ningún admin activo — no se puede aplicar. Dejá al menos un admin activo antes de hacer este cambio.";
export const MENSAJE_GERENTE_SIN_SUCURSAL = "El gerente no puede quedarse sin ninguna sucursal activa: traspasá la gerencia antes de desactivarlo.";
export const MENSAJE_GERENTE_DEJA_DE_SER_ADMIN = "El gerente tiene que ser admin activo en al menos una sucursal: traspasá la gerencia antes de dejar de serlo.";
const MENSAJE_ROL_DE_SISTEMA = "Un rol de sistema no se puede desactivar, borrar ni cambiar de clave: la empresa lo necesita para gobernarse.";

/** D1 — cuántas membresías de «admin efectivo» tiene la empresa (`filtroAdminEfectivo`, `core/permisos/filtros.ts`: la definición ESTRICTA, «queda alguien que pueda entrar»). */
export async function contarAdminsEfectivos(db: Db, empresaId: string): Promise<number> {
  return db.usuarioSucursal.count({ where: filtroAdminEfectivo(empresaId) });
}

/** ¿`usuarioId` es admin efectivo en al menos una sucursal? Lo exige quien asume la gerencia (D4) y lo mantiene el gerente (Q1). */
export async function esAdminEfectivoEnAlgunaSucursal(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: { ...filtroAdminEfectivo(empresaId), usuarioId }, select: { id: true } }));
}

/** ¿Tiene al menos una membresía activa en una sucursal activa? (b) del gerente. */
async function tieneSucursalActiva(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: { empresaId, usuarioId, activo: true, sucursal: { activo: true } }, select: { id: true } }));
}

export interface EstadoDeGobierno {
  adminsEfectivos: number;
  /** `null`: la empresa no tiene gerente (no hay nada que cuidar). */
  gerente: { conSucursalActiva: boolean; adminEfectivo: boolean } | null;
}

export async function medirEstadoDeGobierno(db: Db, empresaId: string): Promise<EstadoDeGobierno> {
  const fila = await db.usuarioEmpresa.findFirst({ where: filtroDelGerente(empresaId), select: { usuarioId: true } });
  return {
    adminsEfectivos: await contarAdminsEfectivos(db, empresaId),
    gerente: fila
      ? {
          conSucursalActiva: await tieneSucursalActiva(db, empresaId, fila.usuarioId),
          adminEfectivo: await esAdminEfectivoEnAlgunaSucursal(db, empresaId, fila.usuarioId),
        }
      : null,
  };
}

/** (a) Si había algún admin efectivo, tiene que seguir habiéndolo. */
export function invarianteQuedaUnAdmin(antes: EstadoDeGobierno, despues: EstadoDeGobierno): string | null {
  return antes.adminsEfectivos >= 1 && despues.adminsEfectivos === 0 ? MENSAJE_SIN_ADMIN_ACTIVO : null;
}

/** (b) Si el gerente tenía una sucursal activa, tiene que seguir teniéndola. */
export function invarianteGerenteConSucursalActiva(antes: EstadoDeGobierno, despues: EstadoDeGobierno): string | null {
  return antes.gerente?.conSucursalActiva && despues.gerente && !despues.gerente.conSucursalActiva ? MENSAJE_GERENTE_SIN_SUCURSAL : null;
}

/** (f) Si el gerente era admin efectivo, tiene que seguir siéndolo mientras sea el gerente. */
export function invarianteGerenteEsAdminEfectivo(antes: EstadoDeGobierno, despues: EstadoDeGobierno): string | null {
  return antes.gerente?.adminEfectivo && despues.gerente && !despues.gerente.adminEfectivo ? MENSAJE_GERENTE_DEJA_DE_SER_ADMIN : null;
}

/** El primer mensaje de las invariantes de estado que el cambio empeoró, o `null` si ninguna. */
function primeraInvarianteViolada(antes: EstadoDeGobierno, despues: EstadoDeGobierno): string | null {
  return invarianteQuedaUnAdmin(antes, despues) ?? invarianteGerenteConSucursalActiva(antes, despues) ?? invarianteGerenteEsAdminEfectivo(antes, despues);
}

/** Se lanza adentro de la transacción para deshacer la escritura; la acción la captura y devuelve el mensaje como error de negocio. */
export class InvarianteViolada extends Error {
  constructor(readonly mensaje: string) {
    super(mensaje);
    this.name = "InvarianteViolada";
  }
}

/**
 * Mide el estado de gobierno, corre la escritura y vuelve a medir: si la escritura empeoró (a), (b) o (f), lanza `InvarianteViolada` y la
 * transacción entera se deshace. Va dentro de `conTransaccionSerializable`: dos pedidos simultáneos que se sacan el último admin el uno al
 * otro no pueden aplicarse los dos.
 */
export async function conInvariantesDeGobierno<T>(tx: Db, empresaId: string, escribir: () => Promise<T>): Promise<T> {
  const antes = await medirEstadoDeGobierno(tx, empresaId);
  const resultado = await escribir();
  const mensaje = primeraInvarianteViolada(antes, await medirEstadoDeGobierno(tx, empresaId));
  if (mensaje) throw new InvarianteViolada(mensaje);
  return resultado;
}

/** (c) Un rol con clave es de sistema: no se desactiva ni se borra ni cambia de clave. Devuelve el mensaje si el rol está protegido. */
export function invarianteRolDeSistemaIntacto(rol: { clave: string | null }): string | null {
  return rol.clave === null ? null : MENSAJE_ROL_DE_SISTEMA;
}

/**
 * (e) Definición AMPLIA de «usuario activo» (D7): cualquier membresía activa con ese rol, sea cual sea su sucursal, su pertenencia o su cuenta.
 * «Nadie queda colgado de un rol que se apaga»: no es lo mismo que «queda alguien que pueda entrar» (a), que es la estricta.
 */
export async function contarUsuariosActivosDelRol(db: Db, rolId: string): Promise<number> {
  return db.usuarioSucursal.count({ where: { rolId, activo: true } });
}

/** (e) Un rol con usuarios activos no se desactiva sin reasignarlos antes. */
export async function invarianteRolSinUsuariosActivos(db: Db, rol: { id: string; nombre: string }): Promise<string | null> {
  return (await contarUsuariosActivosDelRol(db, rol.id)) > 0
    ? `No se puede desactivar "${rol.nombre}": todavía hay usuarios activos con ese rol. Reasignalos primero.`
    : null;
}
