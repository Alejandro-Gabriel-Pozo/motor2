import "server-only";
import type { Prisma } from "@prisma/client";
import { ROL_EMPRESA_GERENTE } from "@/core/permisos/rol-empresa";

/**
 * Persistencia del TRASPASO DE LA GERENCIA (Hito 3, Fase I, I.5d de `docs/plan-hito-3-pureza.md`). Son EXACTAMENTE las dos escrituras que
 * `transferirGerenciaDeEmpresa` hacía en línea en `core/permisos/gerencia.ts`, mudadas tal cual. Sin reglas: a quién se le pasa la gerencia, si puede recibirla y
 * qué pasa si la baja no aplica lo decide el paso compartido `server/actions/auth/casos-de-uso/transferir-gerencia-en-tx.ts`, y la auditoría la hace el caso de uso.
 * El cliente es SIEMPRE el primer parámetro, la transacción de quien llama (nunca `db = prisma` por defecto).
 */

/**
 * Le saca la gerencia a la pertenencia `pertenenciaId` SOLO si sigue siendo la del gerente (baja condicional): dos traspasos simultáneos no pueden aplicarse
 * los dos. Devuelve cuántas filas cambió (1 si se dio de baja; 0 si la gerencia ya había cambiado de manos).
 */
export async function bajarGerenciaSiSigue(tx: Prisma.TransactionClient, entrada: { pertenenciaId: string }): Promise<number> {
  const baja = await tx.usuarioEmpresa.updateMany({ where: { id: entrada.pertenenciaId, rolEmpresa: ROL_EMPRESA_GERENTE }, data: { rolEmpresa: null } });
  return baja.count;
}

/** Hace gerente de la empresa a la pertenencia `pertenenciaId`. */
export async function darGerencia(tx: Prisma.TransactionClient, entrada: { pertenenciaId: string }): Promise<void> {
  await tx.usuarioEmpresa.update({ where: { id: entrada.pertenenciaId }, data: { rolEmpresa: ROL_EMPRESA_GERENTE } });
}
