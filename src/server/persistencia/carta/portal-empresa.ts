import "server-only";
import type { Prisma } from "@prisma/client";
import type { ValoresPortal } from "@/core/carta/public";

/**
 * Escritura del PORTAL de la empresa (`PortalCartaEmpresa`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de `server/persistencia/`:
 * el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Es EXACTAMENTE el `upsert` que antes hacía en línea
 * `src/server/actions/carta/portal-empresa.ts`; lo llama solo el caso de uso `guardar-portal-empresa.ts` de `src/server/actions/carta/casos-de-uso/`, con la base del
 * contexto y sin transacción, como antes (la apariencia no es plata: sin auditoría).
 */

/**
 * Guarda los valores del portal de la empresa (una fila por empresa, `empresaId` único: guardar dos veces lo mismo es idempotente; reemplaza TODO lo guardado). El `create` lleva el MISMO `empresaId` del `where` a
 * propósito: así Prisma lo manda como un solo `INSERT … ON CONFLICT DO UPDATE` (atómico); con el `empresaId` por default del servidor hacía leer-y-después-escribir y dos primeros guardados a la vez chocaban con la restricción única.
 */
export async function guardarValoresDelPortal(db: Prisma.TransactionClient, args: { empresaId: string; valores: ValoresPortal }): Promise<void> {
  const json = args.valores as Prisma.InputJsonObject;
  await db.portalCartaEmpresa.upsert({
    where: { empresaId: args.empresaId },
    create: { empresaId: args.empresaId, valores: json },
    update: { valores: json },
    select: { id: true },
  });
}
