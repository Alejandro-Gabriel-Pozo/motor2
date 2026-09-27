import "server-only";
import { prisma, type Db } from "@/lib/db";

/**
 * Lecturas del POS › Mapa de mesas para los Server Components (Task #41, Fase D8). Mismo contrato que el piloto
 * (`server/consultas/catalogo/productos.ts`): `server-only` sin `"use server"`, sin guarda de permiso adentro (la página hace
 * `requierePermisoVer` antes), `sucursalId` sale de `ctx` en el servidor, último parámetro `db: Db = prisma`, y devuelve
 * EXACTAMENTE lo que devolvía la consulta Prisma en línea que reemplaza.
 *
 * El mapa en sí (`obtenerMapaDeMesas`) NO vive acá: es lógica de dominio de `core/pos/mesas.ts` y se queda ahí.
 */

/**
 * Límite de mesas abiertas de la sucursal (`/mesas`, «LimiteMesasAbiertas»): SOLO `{ maxMesasAbiertas }` (`null` = sin límite).
 * `findUniqueOrThrow` a propósito: la sucursal sale del contexto de la sesión, así que si no existe es un error, no «sin límite».
 */
export async function obtenerLimiteMesasAbiertas(sucursalId: string, db: Db = prisma) {
  return db.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { maxMesasAbiertas: true } });
}
