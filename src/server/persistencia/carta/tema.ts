import "server-only";
import type { Prisma } from "@prisma/client";
import type { ValoresTema } from "@/core/carta/public";

/**
 * Escrituras del TEMA de la carta (`TemaCartaSucursal`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de `server/persistencia/`: el
 * cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Es la escritura que antes hacía en línea
 * `src/server/actions/carta/tema.ts`; la llama solo el caso de uso `guardar-tema-carta.ts` de
 * `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin transacción, como antes (el tema visual no es plata: sin auditoría).
 */

/**
 * Guarda los valores del tema de una sucursal (reemplaza TODO lo guardado): `upsert` por `(empresaId, sucursalId)`. El `create` lleva los MISMOS `empresaId` y `sucursalId` del `where` a propósito: así Prisma lo
 * manda como un solo `INSERT … ON CONFLICT DO UPDATE` (atómico); con el `empresaId` por default del servidor hacía leer-y-después-escribir y dos primeros guardados a la vez chocaban con la restricción única. Guardar = aplicar: crea o edita la fila con `aplicarEnCarta: true`.
 */
export async function guardarValoresDelTema(db: Prisma.TransactionClient, args: { empresaId: string; sucursalId: string; valores: ValoresTema }): Promise<void> {
  const json = args.valores as Prisma.InputJsonObject;
  await db.temaCartaSucursal.upsert({
    where: { empresaId_sucursalId: { empresaId: args.empresaId, sucursalId: args.sucursalId } },
    create: { empresaId: args.empresaId, sucursalId: args.sucursalId, valores: json, aplicarEnCarta: true },
    update: { valores: json, aplicarEnCarta: true },
  });
}
