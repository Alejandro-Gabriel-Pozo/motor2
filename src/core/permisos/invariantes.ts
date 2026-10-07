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
 *
 * Desde la Fase II del Hito 3 (II.3 de `docs/plan-hito-3-pureza.md`) este archivo es PURO (P0): las reglas y sus mensajes. Las lecturas que miden el estado
 * (`medirEstadoDeGobierno`, `contarAdminsEfectivos`, `esAdminEfectivoEnAlgunaSucursal`, `contarUsuariosActivosDelRol`, `invarianteRolSinUsuariosActivos`) viven
 * en `server/lecturas/permisos/gobierno.ts` con el mismo nombre y firma, y `conInvariantesDeGobierno` (medir, escribir, volver a medir) en
 * `server/actions/con-gobierno.ts`, junto a la transacción de gobierno.
 */

export const MENSAJE_SIN_ADMIN_ACTIVO = "Esta operación dejaría el sistema sin ningún admin activo — no se puede aplicar. Dejá al menos un admin activo antes de hacer este cambio.";
export const MENSAJE_GERENTE_SIN_SUCURSAL = "El gerente no puede quedarse sin ninguna sucursal activa: traspasá la gerencia antes de desactivarlo.";
export const MENSAJE_GERENTE_DEJA_DE_SER_ADMIN = "El gerente tiene que ser admin activo en al menos una sucursal: traspasá la gerencia antes de dejar de serlo.";
const MENSAJE_ROL_DE_SISTEMA = "Un rol de sistema no se puede desactivar, borrar ni cambiar de clave: la empresa lo necesita para gobernarse.";

export interface EstadoDeGobierno {
  adminsEfectivos: number;
  /** `null`: la empresa no tiene gerente (no hay nada que cuidar). */
  gerente: { conSucursalActiva: boolean; adminEfectivo: boolean } | null;
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

/** El primer mensaje de las invariantes de estado que el cambio empeoró, o `null` si ninguna. Lo usa `conInvariantesDeGobierno` (`server/actions/con-gobierno.ts`). */
export function primeraInvarianteViolada(antes: EstadoDeGobierno, despues: EstadoDeGobierno): string | null {
  return invarianteQuedaUnAdmin(antes, despues) ?? invarianteGerenteConSucursalActiva(antes, despues) ?? invarianteGerenteEsAdminEfectivo(antes, despues);
}

/** Se lanza adentro de la transacción para deshacer la escritura; la acción la captura y devuelve el mensaje como error de negocio. */
export class InvarianteViolada extends Error {
  constructor(readonly mensaje: string) {
    super(mensaje);
    this.name = "InvarianteViolada";
  }
}

/** (c) Un rol con clave es de sistema: no se desactiva ni se borra ni cambia de clave. Devuelve el mensaje si el rol está protegido. */
export function invarianteRolDeSistemaIntacto(rol: { clave: string | null }): string | null {
  return rol.clave === null ? null : MENSAJE_ROL_DE_SISTEMA;
}

/**
 * (e) Un rol con usuarios activos no se desactiva sin reasignarlos antes: el mensaje si `activos` (la cuenta AMPLIA, D7: cualquier membresía activa con ese rol) no
 * es cero. La cuenta la lee `invarianteRolSinUsuariosActivos` (`server/lecturas/permisos/gobierno.ts`).
 */
export function mensajeSiElRolTieneUsuariosActivos(rol: { nombre: string }, activos: number): string | null {
  return activos > 0 ? `No se puede desactivar "${rol.nombre}": todavía hay usuarios activos con ese rol. Reasignalos primero.` : null;
}
