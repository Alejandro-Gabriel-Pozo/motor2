import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del FOOD COST OBJETIVO (`MargenObjetivo`; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-16 — `docs/plan-hito-4-pureza.md`
 * §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres
 * escrituras que antes hacía en línea `src/server/actions/reportes/margen-objetivo.ts`; las llama `casos-de-uso/guardar-margen-objetivo.ts` DENTRO de su
 * transacción y junto con su fila de auditoría (el objetivo decide «Food cost alto» y el precio sugerido: `escrituras-auditadas` exige que quien lo escribe audite).
 */

/** Borra el objetivo propio (la categoría vuelve al de la empresa; la empresa, al de por defecto). */
export async function borrarMargenObjetivo(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.margenObjetivo.delete({ where: { id: args.id } });
}

/** Cambia el porcentaje de un objetivo que ya existía. */
export async function fijarMargenObjetivo(db: Prisma.TransactionClient, args: { id: string; foodCostObjetivoPct: number }): Promise<void> {
  await db.margenObjetivo.update({ where: { id: args.id }, data: { foodCostObjetivoPct: args.foodCostObjetivoPct } });
}

/** Crea el objetivo de la empresa (`categoriaId` null) o de una categoría. */
export async function crearMargenObjetivo(db: Prisma.TransactionClient, args: { categoriaId: string | null; foodCostObjetivoPct: number }): Promise<void> {
  await db.margenObjetivo.create({ data: { categoriaId: args.categoriaId, foodCostObjetivoPct: args.foodCostObjetivoPct } });
}
