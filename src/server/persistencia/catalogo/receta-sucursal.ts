import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escritura de la RECETA PROPIA de una sucursal (`RecetaSucursal`; Hito 4 de la pureza, bloque 4.2, paso H4C-6 — `docs/plan-hito-4-pureza.md` §3; mismo contrato
 * que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Es EXACTAMENTE la escritura que antes hacía
 * en línea `volverALaRecetaCentral` (`src/server/actions/catalogo/receta-sucursal.ts`); la llama solo el caso de uso
 * `src/server/actions/catalogo/casos-de-uso/volver-a-la-receta-central.ts`, dentro de su transacción SERIALIZABLE y junto con su fila de auditoría. Las versiones
 * de la propia (crear, agregar, editar, quitar, copiar) las escribe `server/persistencia/catalogo/guardar-version-de-receta.ts`.
 */

/** Deshabilita la receta propia (vuelve a regir la central). No borra nada: sus versiones quedan como historial. */
export async function deshabilitarRecetaPropia(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.recetaSucursal.update({ where: { id: args.id }, data: { habilitada: false } });
}
