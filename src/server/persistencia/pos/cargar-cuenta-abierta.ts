import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * La CUENTA ABIERTA de una mesa de la sucursal (Hito 4 de la pureza, bloque 4.1, paso 13 — `docs/plan-hito-4-pureza.md` §5). Vivía en
 * `src/server/actions/pos/cuenta-comun.ts` mientras alguna Server Action del POS la llamaba en línea; desde que las 10 acciones del salón pasan por su caso de
 * uso, solo la llaman los casos de uso de `src/server/actions/pos/casos-de-uso/` (liberar la mesa, corregir comensales, asignar el cliente, quitar un ítem,
 * enviar a cocina y agregar ítems), siempre con el `tx` de su transacción serializable. Mismo contrato que el resto de `server/persistencia/pos/`: el cliente
 * es el PRIMER parámetro. Movida TAL CUAL: la misma lectura y los mismos mensajes (los fija `huella-del-pos`).
 */

export type CuentaAbierta = { id: string; clienteId: string | null; descuentoPorcentaje: Prisma.Decimal | null; mesa: { id: string; numero: number } };

/** La cuenta pedida, si es de una mesa de esta sucursal y sigue abierta; si no, el mensaje de error listo para devolver. */
export async function cuentaAbiertaDeSucursal(tx: Prisma.TransactionClient, cuentaId: string, sucursalId: string): Promise<{ ok: true; cuenta: CuentaAbierta } | { ok: false; mensaje: string }> {
  const cuenta = typeof cuentaId === "string" ? await tx.cuenta.findFirst({ where: { id: cuentaId, mesa: { sucursalId } }, include: { mesa: { select: { id: true, numero: true } } } }) : null;
  if (!cuenta) return { ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." };
  if (cuenta.cerradaEn) return { ok: false, mensaje: `La cuenta de la mesa ${cuenta.mesa.numero} ya está cerrada.` };
  return { ok: true, cuenta };
}
