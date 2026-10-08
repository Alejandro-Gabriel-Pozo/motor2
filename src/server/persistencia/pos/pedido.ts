import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del PEDIDO de la cuenta de una mesa (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto de
 * `server/persistencia/pos/`: `tx` OBLIGATORIO y primer parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/cuenta-pedido.ts`; el orden y las validaciones los pone cada caso de uso de `src/server/actions/pos/casos-de-uso/`. Sin
 * auditoría: `CuentaItem` y `PromoCuenta` son documentos del POS con su usuario y su estado («su propia historia», `escrituras-auditadas.test.ts`).
 */

/**
 * Borra un ítem que TODAVÍA NO SALIÓ a cocina (un borrador: DELETE físico). La condición vive en el MISMO borrado (`numeroEnvio: null` y nunca una fila
 * espejo): si otro mozo lo envió un instante antes, no se borra nada. Devuelve cuántas filas borró (0 o 1): con 0 el caso de uso responde «ya salió a cocina».
 */
export async function borrarItemSinEnviar(tx: Prisma.TransactionClient, args: { cuentaItemId: string }): Promise<number> {
  const borrados = await tx.cuentaItem.deleteMany({ where: { id: args.cuentaItemId, numeroEnvio: null, anulaAItemId: null } });
  return borrados.count;
}

/**
 * Borra una promo que TODAVÍA NO SALIÓ a cocina, entera: primero TODOS sus `CuentaItem` componentes y después la `PromoCuenta` (en ese orden: los
 * componentes la referencian y la relación no borra en cascada). Que ningún componente haya salido lo chequea antes el caso de uso, en la misma transacción.
 */
export async function borrarPromoSinEnviar(tx: Prisma.TransactionClient, args: { promoCuentaId: string }): Promise<void> {
  await tx.cuentaItem.deleteMany({ where: { promoCuentaId: args.promoCuentaId } });
  await tx.promoCuenta.delete({ where: { id: args.promoCuentaId } });
}
