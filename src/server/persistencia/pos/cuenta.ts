import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de la APERTURA de la cuenta de una mesa (Hito 4 de la pureza, bloque 4.1 — `docs/plan-hito-4-pureza.md` §5; mismo contrato que el resto de
 * `server/persistencia/pos/`: `tx` OBLIGATORIO y primer parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en
 * línea `src/server/actions/pos/cuenta-apertura.ts`; el orden, las validaciones y la auditoría los pone cada caso de uso de
 * `src/server/actions/pos/casos-de-uso/`. Liberar la mesa no tiene escritura propia acá: reutiliza `marcarCuentaCerrada` (./cerrar-cuenta.ts).
 */

/** Cambia los comensales de la cuenta (la cuenta sigue abierta: lo chequea el caso de uso). */
export async function cambiarComensalesDeCuenta(tx: Prisma.TransactionClient, args: { cuentaId: string; comensales: number }): Promise<void> {
  await tx.cuenta.update({ where: { id: args.cuentaId }, data: { comensales: args.comensales } });
}
