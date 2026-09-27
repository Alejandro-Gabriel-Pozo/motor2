import "server-only";
import { prisma, type Db } from "@/lib/db";

/**
 * Lecturas de Permisos › Roles para los Server Components (Task #41, Fase D5). Mismo contrato que
 * `src/server/consultas/catalogo/productos.ts` (piloto D1): `server-only`, sin `"use server"`, sin guarda de permiso adentro
 * (la página hace `requierePermisoVer(...)` antes), `db: Db = prisma` al final, devuelve exactamente lo que devolvía la
 * consulta Prisma que reemplaza.
 *
 * Por qué NO se reusa la Server Action `listarRoles` (`src/server/actions/permisos/roles.ts`), aunque lea la misma tabla:
 *  - exige `gestion_permisos`, y la página de Usuarios se abre con `gestion_usuarios`: un usuario con este permiso y sin
 *    aquel vería la página caerse al llamarla (la matriz de permisos es editable, los dos no van necesariamente juntos);
 *  - trae TODOS los roles (sin filtrar por `activo`) para el panel de Permisos, que es donde se activan/desactivan; acá solo
 *    se ofrecen para asignar los roles activos.
 */

/** Roles activos, por nombre ascendente: los que el alta/edición de una membresía (`/administracion/usuarios`) ofrece asignar. */
export async function listarRolesActivos(db: Db = prisma) {
  return db.rol.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}
