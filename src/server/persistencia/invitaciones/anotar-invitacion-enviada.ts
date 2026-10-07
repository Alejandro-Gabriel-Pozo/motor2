import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Persistencia del ENVÍO de una invitación (Hito 3, Fase I, I.5f de `docs/plan-hito-3-pureza.md`): la marca `enviadaEn` que `enviarInvitacionYAnotar` escribía en línea
 * (antes en `src/server/invitaciones-de-usuario.ts`), mudada tal cual. Sin reglas: cuándo se anota (solo si el mail salió) lo decide ese paso. El cliente es SIEMPRE el primer
 * parámetro y lo pasa quien llama: acá es el de la empresa (`ctx.db`), fuera de toda transacción, porque se anota DESPUÉS de mandar el mail, que no se puede deshacer.
 *
 * Condicional a que la invitación siga PENDIENTE: si entre el commit y el envío la aceptaron o la revocaron, no se toca.
 */
export async function anotarInvitacionEnviada(db: Db, entrada: { invitacionId: string; ahora: Date }): Promise<void> {
  await db.invitacion.updateMany({ where: { id: entrada.invitacionId, estado: "PENDIENTE" }, data: { enviadaEn: entrada.ahora } });
}
