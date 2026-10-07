import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de las MEMBRESÍAS (Hito 3, B3-8 de `docs/plan-hito-3-pureza.md`): la cuenta de una persona en una empresa (`UsuarioEmpresa`) y su membresía en una sucursal
 * (`UsuarioSucursal`). Son EXACTAMENTE las escrituras que el caso de uso `aceptar-invitacion-de-usuario.ts` hacía en línea; viven en `server/persistencia/permisos/` (y no en
 * `invitaciones/`) para que las reutilice la migración de `server/actions/auth/usuarios.ts` (Fase I del Hito 3), que escribe las mismas tablas. Sin reglas de negocio: quién,
 * dónde y con qué rol lo decide el caso de uso, que además audita (estas funciones no auditan: lo vigila la cadena de `escrituras-auditadas`). El cliente es SIEMPRE el primer
 * parámetro, la transacción del caso de uso (nunca `db = prisma` por defecto), y corre dentro de `conInvariantesDeGobierno`.
 */

/** Crea la cuenta de la persona en la empresa, o la reactiva si ya existía (apagada o no). */
export async function activarCuentaEnEmpresa(tx: Prisma.TransactionClient, entrada: { usuarioId: string; empresaId: string }): Promise<void> {
  const { usuarioId, empresaId } = entrada;
  await tx.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId, empresaId } },
    update: { activo: true },
    create: { usuarioId, empresaId },
  });
}

/**
 * Reactiva la cuenta YA EXISTENTE de la persona en la empresa (un `update`: si no existiera, falla; quien llama ya leyó que existe). Hito 3, I.4: la usa el alta
 * de sucursal con su primer admin, que solo nombra a alguien que ya forma parte de la empresa (E8, ADR-024).
 */
export async function reactivarCuentaEnEmpresa(tx: Prisma.TransactionClient, entrada: { usuarioId: string; empresaId: string }): Promise<void> {
  const { usuarioId, empresaId } = entrada;
  await tx.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId } }, data: { activo: true } });
}

/** Crea la membresía de la persona en una sucursal, con ese rol y esas notas (Hito 3, I.4: el primer admin de una sucursal recién creada). Devuelve la membresía. */
export async function crearMembresiaEnSucursal(
  tx: Prisma.TransactionClient,
  entrada: { usuarioId: string; sucursalId: string; empresaId: string; rolId: string; notas: string },
): Promise<{ id: string }> {
  const { usuarioId, sucursalId, empresaId, rolId, notas } = entrada;
  return tx.usuarioSucursal.create({ data: { usuarioId, sucursalId, empresaId, rolId, notas } });
}

/**
 * La membresía que da una invitación en una sucursal: la crea, o actualiza la que ya existía (rol y activo; las notas solo si la invitación trae notas, para no borrar las que
 * hubiera). Devuelve la membresía (el caso de uso usa su id en la auditoría).
 */
export async function asignarMembresiaPorInvitacion(
  tx: Prisma.TransactionClient,
  entrada: { usuarioId: string; sucursalId: string; empresaId: string; rolId: string; notas: string | null },
): Promise<{ id: string }> {
  const { usuarioId, sucursalId, empresaId, rolId, notas } = entrada;
  return tx.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    update: { rolId, activo: true, ...(notas !== null && { notas }) },
    create: { usuarioId, sucursalId, empresaId, rolId, ...(notas !== null && { notas }) },
  });
}
