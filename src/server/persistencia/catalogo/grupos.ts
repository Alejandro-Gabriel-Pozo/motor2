import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los GRUPOS DE INSUMOS (`Grupo`; Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras de grupos que antes hacía en
 * línea `src/server/actions/catalogo/insumos.ts`; las llaman los casos de uso `crear-o-actualizar-grupo.ts` y `actualizar-activo-grupo.ts`, con la base del
 * contexto y sin transacción (como antes). Un grupo no es plata: no se audita. Las lecturas de grupos (cadenas, ciclos) están en server/lecturas/catalogo/grupos.ts.
 */

/** Crea el grupo con ese nombre y ese padre (`null` = raíz). Devuelve el nombre guardado. */
export async function crearGrupoNuevo(db: Prisma.TransactionClient, args: { nombre: string; grupoPadreId: string | null }): Promise<{ nombre: string }> {
  const creado = await db.grupo.create({ data: { nombre: args.nombre, grupoPadreId: args.grupoPadreId } });
  return { nombre: creado.nombre };
}

/** Le cambia el padre a un grupo existente (`null` = raíz). */
export async function fijarPadreDeGrupo(db: Prisma.TransactionClient, args: { id: string; grupoPadreId: string | null }): Promise<void> {
  await db.grupo.update({ where: { id: args.id }, data: { grupoPadreId: args.grupoPadreId } });
}

/** Activa o desactiva el grupo. Un id que no existe hace lanzar a Prisma (como antes). */
export async function fijarActivoDeGrupo(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.grupo.update({ where: { id: args.id }, data: { activo: args.activo } });
}
