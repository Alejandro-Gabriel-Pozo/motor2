import "server-only";
import { filtroMembresiaConAutoridadDeAdmin, filtroRolAdmin } from "@/core/permisos/filtros";
import { tuvoRolAdminEnLaEmpresa } from "@/server/lecturas/permisos/gerencia";
import { personaEnSucursal, reactivaLaMembresiaDeUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { SELECCION_DE_ROL_PARA_JERARQUIA, type PersonaParaJerarquia } from "@/core/permisos/jerarquia";
import type { Db } from "@/lib/db-tipos";

/**
 * Las LECTURAS de decisión del techo de privilegio de la gestión de usuarios (Bloque G, G2; Hito 3, Fase II, II.4 de `docs/plan-hito-3-pureza.md`, contrato B4a).
 * Vivían en `core/permisos/gestion-de-usuarios.ts` junto con las reglas; se mudaron TAL CUAL, con el MISMO nombre y la MISMA firma (ADR-026 §5: `db` primero, como
 * estaban), para que la mudanza solo cambiara la ruta del import: las mismas consultas, en el mismo orden. Lo que tenían de regla (si el rol de una membresía es el de
 * administrador, si activarla reactiva a un administrador) quedó PURO en `core/permisos/gestion-de-usuarios.ts` (`personaEnSucursal`, `reactivaLaMembresiaDeUnAdmin`):
 * acá no se nombra la clave del rol (regla 4 de `acceso-solo-por-el-guard`); los predicados por clave son los filtros de `core/permisos/filtros.ts` (C1).
 *
 * Capa `server/lecturas` (ADR-026): solo lectura, sin guarda propia (el permiso de la acción lo evalúa el guard antes), la importan los casos de uso de gobierno,
 * nunca la UI. Corren con el cliente que les pasan: casi siempre la transacción serializable de la escritura (`tx`).
 */

async function rolEmpresaDe(db: Db, empresaId: string, usuarioId: string | null): Promise<string | null> {
  if (!usuarioId) return null;
  const fila = await db.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId, empresaId } }, select: { rolEmpresa: true } });
  return fila?.rolEmpresa ?? null;
}

/** Quien OTORGÓ el acceso a una sucursal, medido desde la base (E8: se revalida su techo al aceptar una invitación, cuando ya no hay sesión suya): administrador si su membresía de esa sucursal lo es. */
export async function actorDesdeLaBase(db: Db, empresaId: string, usuarioId: string, sucursalId: string): Promise<PersonaParaJerarquia> {
  const admin = await db.usuarioSucursal.findFirst({ where: { ...filtroMembresiaConAutoridadDeAdmin(empresaId, usuarioId), sucursalId }, select: { id: true } });
  return { rolEmpresa: await rolEmpresaDe(db, empresaId, usuarioId), esAdminEnElContexto: admin !== null };
}

/** A quien se toca por su membresía en una sucursal: administrador si el rol de ESA membresía lo es (sin membresía o sin usuario todavía, operario). */
export async function objetivoEnSucursal(db: Db, empresaId: string, usuarioId: string | null, rolDeLaMembresia: { clave: string | null } | null): Promise<PersonaParaJerarquia> {
  return personaEnSucursal(await rolEmpresaDe(db, empresaId, usuarioId), rolDeLaMembresia);
}

/** A quien se toca por su cuenta en la empresa: administrador si tiene una membresía activa con un rol admin activo en cualquier sucursal. */
export async function objetivoEnLaEmpresa(db: Db, empresaId: string, usuarioId: string): Promise<PersonaParaJerarquia> {
  const esAdmin = await db.usuarioSucursal.findFirst({ where: filtroMembresiaConAutoridadDeAdmin(empresaId, usuarioId), select: { id: true } });
  return { rolEmpresa: await rolEmpresaDe(db, empresaId, usuarioId), esAdminEnElContexto: esAdmin !== null };
}

/** El rol «admin» de la empresa, buscado por su CLAVE técnica (el nombre se puede cambiar: bloque G3), con la selección de la jerarquía (C3). `null` si la empresa no lo tiene. */
export async function buscarRolAdmin(db: Db, empresaId: string) {
  return db.rol.findFirst({ where: filtroRolAdmin(empresaId), select: SELECCION_DE_ROL_PARA_JERARQUIA });
}

/**
 * ¿Lo que se pide reactiva a un administrador? Su membresía en la sucursal (apagada, con rol admin: `reactivaLaMembresiaDeUnAdmin`, puro) o su cuenta en la empresa
 * (apagada, y tiene o tuvo el rol admin: pregunta histórica, `tuvoRolAdminEnLaEmpresa`, que no filtra roles inactivos — Q2; se lee solo si la cuenta está apagada).
 * Quien tiene `gestion_usuarios` no puede deshacer por esta vía lo que el gerente apagó con `apagar_cuenta_empresa`.
 */
export async function reactivaAUnAdmin(
  db: Db,
  empresaId: string,
  usuarioId: string,
  que: { membresia?: { activo: boolean; rol: { clave: string | null } } | null; cuentaDeEmpresa?: { activo: boolean } | null }
): Promise<boolean> {
  if (reactivaLaMembresiaDeUnAdmin(que.membresia)) return true;
  return Boolean(que.cuentaDeEmpresa && !que.cuentaDeEmpresa.activo && (await tuvoRolAdminEnLaEmpresa(db, empresaId, usuarioId)));
}
