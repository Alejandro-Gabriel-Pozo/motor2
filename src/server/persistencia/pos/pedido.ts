import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del PEDIDO de la cuenta de una mesa (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto de
 * `server/persistencia/pos/`: `tx` OBLIGATORIO y primer parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/cuenta-pedido.ts`; el orden y las validaciones los pone cada caso de uso de `src/server/actions/pos/casos-de-uso/`. Sin
 * auditoría: `CuentaItem` y `PromoCuenta` son documentos del POS con su usuario y su estado («su propia historia», `escrituras-auditadas.test.ts`).
 */

/**
 * Una `PromoCuenta` nueva en la cuenta, con el precio y el título CONGELADOS de la promo de la carta (ya revalidada y prorrateada por el caso de uso) y quién
 * la cargó. Devuelve su id: los `CuentaItem` componentes la referencian, así que va ANTES que `escribirItemsDeCuenta`.
 */
export async function escribirPromoDeCuenta(
  tx: Prisma.TransactionClient,
  args: { cuentaId: string; promoCartaId: string; precio: number; titulo: string; creadoPorId: string },
): Promise<string> {
  const promoCuenta = await tx.promoCuenta.create({ data: { cuentaId: args.cuentaId, promoCartaId: args.promoCartaId, precio: args.precio, titulo: args.titulo, creadoPorId: args.creadoPorId } });
  return promoCuenta.id;
}

/**
 * Todos los `CuentaItem` SIN ENVIAR de un agregado (sueltos y componentes de promo, ya validados y con el precio congelado) en UN solo `createMany`: una sola
 * escritura por agregado, siempre la última (lo fija `test/pos/agregar-items-consultas.test.ts`).
 */
export async function escribirItemsDeCuenta(tx: Prisma.TransactionClient, filas: Prisma.CuentaItemCreateManyInput[]): Promise<void> {
  await tx.cuentaItem.createMany({ data: filas });
}

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

/**
 * «Enviar a cocina»: los ítems pedidos (los ids que calculó el caso de uso, ya con los hermanos de promo) que sigan SIN enviar y no sean filas espejo pasan al
 * envío `numeroEnvio` de la cuenta. La condición vive en el MISMO `UPDATE`: un ítem que otro mozo envió o quitó un instante antes no se toca. Devuelve cuántas
 * filas cambió (con 0, el caso de uso responde el caso idempotente).
 */
export async function enviarItemsACocina(tx: Prisma.TransactionClient, args: { cuentaId: string; itemIds: string[]; numeroEnvio: number }): Promise<number> {
  const enviados = await tx.cuentaItem.updateMany({
    where: { id: { in: args.itemIds }, cuentaId: args.cuentaId, numeroEnvio: null, anulaAItemId: null },
    data: { numeroEnvio: args.numeroEnvio },
  });
  return enviados.count;
}
