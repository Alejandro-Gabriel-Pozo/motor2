import "server-only";
import type { Prisma } from "@prisma/client";
import { FILTRO_DE_ROLES_PROPIOS_ACTIVOS } from "@/core/permisos/cupo-de-roles-propios";

/**
 * Persistencia de los ROLES (`Rol`; Hito 3, Fase I, I.2 de `docs/plan-hito-3-pureza.md`). Son EXACTAMENTE las escrituras que las Server Actions de
 * `src/server/actions/permisos/roles.ts` hacían en línea, mudadas tal cual. Sin reglas de negocio ni auditoría: qué nombre, qué rol y si se puede lo decide
 * cada caso de uso (`server/actions/permisos/casos-de-uso/{crear-rol,renombrar-rol,actualizar-activo-rol}.ts`), que además audita en la misma transacción.
 * El cliente es SIEMPRE el primer parámetro, la transacción del caso de uso (nunca `db = prisma` por defecto).
 *
 * Contrato C5 del RBAC (modo ii de `test/arquitectura/escrituras-de-permisos-por-politica.test.ts`): escribir `Rol` vale acá SOLO porque a este archivo lo
 * importan únicamente casos de uso de `server/actions/permisos/`, a esos casos de uso solo los importan Server Actions de su dominio, y cada llamada va DENTRO
 * de `conEdicionDePermisos` (la clave más la política de plataforma, ADR-008). Un importador nuevo de otra capa, o una llamada desde otro envoltorio, rompe
 * esa regla.
 */

/** Da de alta un rol con ese nombre (ya normalizado y validado por el caso de uso). Devuelve su id. */
export async function insertarRol(tx: Prisma.TransactionClient, entrada: { nombre: string }): Promise<{ id: string }> {
  return tx.rol.create({ data: { nombre: entrada.nombre } });
}

/** Cambia el NOMBRE de un rol. Nunca toca la clave (un rol de sistema sigue siendo el mismo con otro nombre: ADR-016). */
export async function cambiarNombreDeRol(tx: Prisma.TransactionClient, entrada: { rolId: string; nombre: string }): Promise<void> {
  await tx.rol.update({ where: { id: entrada.rolId }, data: { nombre: entrada.nombre } });
}

/** Activa o desactiva un rol. */
export async function cambiarActivoDeRol(tx: Prisma.TransactionClient, entrada: { rolId: string; activo: boolean }): Promise<void> {
  await tx.rol.update({ where: { id: entrada.rolId }, data: { activo: entrada.activo } });
}

/**
 * Toma el candado del cupo de roles propios de ESA empresa hasta el final de la transacción (`pg_advisory_xact_lock`): dos altas o reactivaciones a la vez se serializan y la segunda cuenta DESPUÉS de que la primera
 * confirmó, así que con cupo 1 no pasan las dos. Se usa un candado de aviso y no `SELECT … FOR UPDATE` de `Empresa` porque la app solo LEE `Empresa` (S-35): no tiene permiso de actualización sobre esa tabla.
 */
export async function tomarCandadoDeRolesPropios(tx: Prisma.TransactionClient, empresaId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"roles-propios:" + empresaId}, 0))`;
}

/** Cuántos roles PROPIOS (sin clave de sistema) ACTIVOS tiene la empresa del contexto. */
export async function contarRolesPropiosActivos(tx: Prisma.TransactionClient): Promise<number> {
  return tx.rol.count({ where: FILTRO_DE_ROLES_PROPIOS_ACTIVOS });
}
