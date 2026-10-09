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
 * Apaga o reactiva la cuenta de la persona en la empresa (`UsuarioEmpresa.activo`, por el id de la pertenencia). Hito 3, I.5c: la escritura que
 * `actualizarActivoUsuarioEnEmpresa` hacía en línea; corre dentro de `conInvariantesDeGobierno`.
 */
export async function cambiarActivoDeCuentaEnEmpresa(tx: Prisma.TransactionClient, entrada: { pertenenciaId: string; activo: boolean }): Promise<void> {
  await tx.usuarioEmpresa.update({ where: { id: entrada.pertenenciaId }, data: { activo: entrada.activo } });
}

/** Activa o desactiva una membresía. Hito 3, I.5b: la escritura que `actualizarActivoMembresia` hacía en línea; corre dentro de `conInvariantesDeGobierno`. */
export async function cambiarActivoDeMembresia(tx: Prisma.TransactionClient, entrada: { membresiaId: string; activo: boolean }): Promise<void> {
  await tx.usuarioSucursal.update({ where: { id: entrada.membresiaId }, data: { activo: entrada.activo } });
}

/**
 * Le pone a una membresía estas notas (`null` = sin notas). Hito 3, I.5a: la escritura que `actualizarNotasMembresia` (`server/actions/auth/usuarios.ts`) hacía en
 * línea, mudada tal cual; el caso de uso decide el texto y el techo.
 */
export async function cambiarNotasDeMembresia(tx: Prisma.TransactionClient, entrada: { membresiaId: string; notas: string | null }): Promise<void> {
  await tx.usuarioSucursal.update({ where: { id: entrada.membresiaId }, data: { notas: entrada.notas } });
}

/**
 * La membresía de alguien que YA es de la empresa en una sucursal, desde Administración › Usuarios: la crea con ese rol, o actualiza la que ya existía (rol, y la deja
 * activa). Las notas solo se escriben si vinieron (`notas` presente, aunque sea vacía o nula): si no, se conservan las que hubiera. Hito 3, I.5j: la escritura que
 * `agregarOActualizarUsuario` hacía en línea, mudada tal cual (a diferencia de `asignarMembresiaPorInvitacion`, acá «no tocar las notas» es la AUSENCIA del campo, no
 * `null`). Devuelve la membresía (el caso de uso usa su id en la auditoría); corre dentro de `conInvariantesDeGobierno`.
 */
export async function guardarMembresiaDeMiembro(
  tx: Prisma.TransactionClient,
  entrada: { usuarioId: string; sucursalId: string; empresaId: string; rolId: string; notas?: string },
): Promise<{ id: string }> {
  const { usuarioId, sucursalId, empresaId, rolId } = entrada;
  return tx.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    update: { rolId, ...(entrada.notas !== undefined && { notas: entrada.notas }), activo: true },
    create: { usuarioId, sucursalId, empresaId, rolId, ...(entrada.notas !== undefined && { notas: entrada.notas }) },
  });
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
