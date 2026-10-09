import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de las CAPACIDADES por sucursal (`CapacidadSucursal`; Hito 3, Fase I, I.1 de `docs/plan-hito-3-pureza.md`). Es EXACTAMENTE la escritura que la
 * Server Action `actualizarCapacidad` hacía en línea, mudada tal cual (mismas consultas, mismo orden). Sin reglas de negocio ni auditoría: qué clave, qué
 * sucursal y qué valor lo decide el caso de uso `server/actions/permisos/casos-de-uso/actualizar-capacidad.ts`, que además audita en la MISMA transacción. El
 * cliente es SIEMPRE el primer parámetro, la transacción del caso de uso (nunca `db = prisma` por defecto).
 *
 * Toca la matriz de acceso a mano (`capacidadSucursal`): es su trabajo, y por eso figura con sus 3 lecturas/escrituras en las excepciones permanentes de
 * `acceso-solo-por-el-guard.test.ts` (la decisión de acceso la toma el guard, `server/acceso`; esto solo guarda la perilla).
 */

/**
 * Prende o apaga la capacidad `accionClave` en `sucursalId` (`null` = la fila default), creando la fila si no existía. Devuelve el id de la fila y el valor
 * ANTERIOR (`null` si no había fila), que el caso de uso registra en la auditoría.
 *
 * `sucursalId` puede ser `null` (fila default): el tipo generado del unique compuesto `accionClave_sucursalId` no acepta `null` ahí (Prisma no permite un
 * campo nullable como parte del input de una unique compuesta), así que se resuelve con `findFirst` + `create`/`update` en vez de `upsert`. La unicidad real
 * de «una sola fila default por acción» la garantiza el índice único parcial agregado a mano en la migración (ver schema.prisma, comentario en
 * `CapacidadSucursal`): Postgres no la garantiza sola sobre una columna nullable dentro de un `@@unique`.
 */
export async function guardarCapacidadSucursal(
  tx: Prisma.TransactionClient,
  entrada: { accionClave: string; sucursalId: string | null; habilitado: boolean },
): Promise<{ id: string; anterior: boolean | null }> {
  const { accionClave, sucursalId, habilitado } = entrada;
  const existente = await tx.capacidadSucursal.findFirst({ where: { accionClave, sucursalId } });
  const fila = existente
    ? await tx.capacidadSucursal.update({ where: { id: existente.id }, data: { habilitado } })
    : await tx.capacidadSucursal.create({ data: { accionClave, sucursalId, habilitado } });
  return { id: fila.id, anterior: existente?.habilitado ?? null };
}
