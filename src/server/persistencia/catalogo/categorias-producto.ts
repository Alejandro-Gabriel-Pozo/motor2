import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de las CATEGORÍAS DE PRODUCTO (`CategoriaProducto`; Hito 4 de la pureza, bloque 4.3, paso H4C-7 — `docs/plan-hito-4-pureza.md` §3; mismo contrato
 * que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las dos escrituras que antes
 * hacía en línea `src/server/actions/catalogo/categorias-producto.ts`; las llaman los casos de uso `crear-categoria-producto.ts` y
 * `actualizar-activa-categoria-producto.ts`, con la base del contexto y sin transacción (como antes). Una categoría no es plata: no se audita.
 */

/** Crea la categoría con ese nombre (ya recortado y validado). Devuelve el id y el nombre guardado. */
export async function crearCategoriaNueva(db: Prisma.TransactionClient, args: { nombre: string }): Promise<{ id: string; nombre: string }> {
  const creada = await db.categoriaProducto.create({ data: { nombre: args.nombre } });
  return { id: creada.id, nombre: creada.nombre };
}

/**
 * Activa o desactiva la categoría. Devuelve si había una con ese id (visible por RLS): O.44 (Hito 4, bloque D) cambió el `update` —que hacía lanzar a Prisma con
 * un id inexistente o ajeno— por un `updateMany` (atómico, sin una lectura más) cuyo `count` decide el «no encontrado» del caso de uso. Lo que no es texto se
 * descarta ANTES de escribir: en un `where` de `updateMany`, un `undefined` o un objeto (`{ not: "x" }`) no es «ningún id» sino «todas las filas» (S-07).
 */
export async function fijarActivaDeCategoria(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<boolean> {
  if (typeof args.id !== "string") return false;
  const { count } = await db.categoriaProducto.updateMany({ where: { id: args.id }, data: { activo: args.activo } });
  return count > 0;
}
