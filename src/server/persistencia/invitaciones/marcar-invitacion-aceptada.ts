import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de ACEPTAR una invitación (Hito 3, B3-6 de `docs/plan-hito-3-pureza.md`): la escritura que marca la invitación ACEPTADA, EXACTAMENTE la que antes hacía en línea el
 * caso de uso `aceptar-invitacion-de-gerente.ts` (y, desde B3-8, también `aceptar-invitacion-de-usuario.ts`). Sin reglas de negocio: qué invitación, quién y cuándo lo decide el
 * caso de uso. El cliente es SIEMPRE el primer parámetro y es la transacción serializable del caso de uso (nunca `db = prisma` por defecto); la hora entra por parámetro.
 *
 * El update es CONDICIONAL (`estado = PENDIENTE` y no vencida, por id y por hash): es lo que arbitra el reintento y la carrera de dos aceptaciones simultáneas (idempotencia por
 * estado). Devuelve `true` solo si marcó exactamente esa fila.
 */
export async function marcarInvitacionAceptada(
  tx: Prisma.TransactionClient,
  entrada: { invitacionId: string; hashToken: string; aceptadaPorId: string; ahora: Date; cuitDeclarado?: string },
): Promise<boolean> {
  const { invitacionId, hashToken, aceptadaPorId, ahora, cuitDeclarado } = entrada;
  const cambio = await tx.invitacion.updateMany({
    where: { id: invitacionId, hashToken, estado: "PENDIENTE", venceEn: { gt: ahora } },
    data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId, ...(cuitDeclarado !== undefined && { cuitDeclarado }) },
  });
  return cambio.count === 1;
}
