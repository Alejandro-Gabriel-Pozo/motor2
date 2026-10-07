import "server-only";
import type { Prisma } from "@prisma/client";

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
