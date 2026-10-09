import "server-only";
import type { Prisma } from "@prisma/client";
import { ROL_EMPRESA_GERENTE } from "@/core/permisos/rol-empresa";

/**
 * Persistencia de la GERENCIA: el traspaso y, abajo, el alta del primer gerente (Fase II, II.5).
 *
 * El TRASPASO DE LA GERENCIA (Hito 3, Fase I, I.5d de `docs/plan-hito-3-pureza.md`): son EXACTAMENTE las dos escrituras que
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

/*
 * El ALTA DEL PRIMER GERENTE (Hito 3, Fase II, II.5): las dos escrituras que `incorporarPrimerGerente` hacía en línea en `core/permisos/gerencia.ts`, mudadas tal
 * cual y en el mismo orden (primero la cuenta en la empresa, después la membresía). Sin reglas: si la empresa ya tiene gerente, cuál es la primera sucursal activa y
 * cuál es el rol admin lo decide el paso compartido `server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx.ts`, y la auditoría la hace el caso de uso.
 */

/** La cuenta de `usuarioId` en la empresa queda activa y con la gerencia (si no existía, se crea con la gerencia). */
export async function darLaGerenciaAlPrimerGerente(tx: Prisma.TransactionClient, entrada: { usuarioId: string; empresaId: string }): Promise<void> {
  const { usuarioId, empresaId } = entrada;
  await tx.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId, empresaId } },
    update: { activo: true, rolEmpresa: ROL_EMPRESA_GERENTE },
    create: { usuarioId, empresaId, rolEmpresa: ROL_EMPRESA_GERENTE },
  });
}

/** La membresía del primer gerente en `sucursalId`, activa y con el rol `rolId` (el admin); si no existía, se crea con la nota del alta. Devuelve su id, para auditarla. */
export async function darAdminAlPrimerGerente(
  tx: Prisma.TransactionClient,
  entrada: { usuarioId: string; empresaId: string; sucursalId: string; rolId: string },
): Promise<{ id: string }> {
  const { usuarioId, empresaId, sucursalId, rolId } = entrada;
  return tx.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    update: { rolId, activo: true },
    create: { usuarioId, sucursalId, empresaId, rolId, notas: "Alta por invitación de la plataforma." },
    select: { id: true },
  });
}
