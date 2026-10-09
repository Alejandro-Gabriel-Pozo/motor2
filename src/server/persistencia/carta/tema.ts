import "server-only";
import type { Prisma } from "@prisma/client";
import type { ValoresTema } from "@/core/carta/public";

/**
 * Escrituras del TEMA de la carta (`TemaCartaSucursal`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de `server/persistencia/`: el
 * cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres escrituras que antes hacía en línea
 * `src/server/actions/carta/tema.ts`; las llaman solo los casos de uso `guardar-tema-carta.ts` y `cambiar-aplicacion-tema.ts` de
 * `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin transacción, como antes (el tema visual no es plata: sin auditoría).
 */

/**
 * Guarda los valores del tema de una sucursal (reemplaza TODO lo guardado): `upsert` por `(empresaId, sucursalId)`. Al crear la fila no toca `aplicarEnCarta` (queda en
 * borrador); al editar, un tema ya aplicado sigue aplicado. Devuelve si está aplicado.
 */
export async function guardarValoresDelTema(db: Prisma.TransactionClient, args: { empresaId: string; sucursalId: string; valores: ValoresTema }): Promise<{ aplicarEnCarta: boolean }> {
  const json = args.valores as Prisma.InputJsonObject;
  return db.temaCartaSucursal.upsert({
    where: { empresaId_sucursalId: { empresaId: args.empresaId, sucursalId: args.sucursalId } },
    create: { sucursalId: args.sucursalId, valores: json },
    update: { valores: json },
    select: { aplicarEnCarta: true },
  });
}

/** Aplica o desaplica el tema en la carta (los valores guardados se conservan). */
export async function fijarAplicacionDelTema(db: Prisma.TransactionClient, args: { id: string; aplicarEnCarta: boolean }): Promise<void> {
  await db.temaCartaSucursal.update({ where: { id: args.id }, data: { aplicarEnCarta: args.aplicarEnCarta } });
}
