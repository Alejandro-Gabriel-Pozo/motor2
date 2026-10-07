import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de las INVITACIONES DE USUARIO Y DE VINCULACIÓN (E8, ADR-024; Hito 3, Fase I, I.5e2 de `docs/plan-hito-3-pureza.md`). Son EXACTAMENTE las escrituras que
 * hacían en línea `asegurarInvitacionDeUsuario`, `asegurarInvitacionDeVinculacion`, `rotarInvitacionPendiente` y `revocarInvitacionPendiente` (antes en
 * `core/features/empresa/invitacion-de-usuario.ts`), mudadas tal cual. Sin reglas: qué hacer con la pendiente lo decide `decidirSobreLaInvitacionPendiente`
 * (`core/features/empresa/invitacion.ts`), y la composición, el token y la auditoría quedan en el paso compartido
 * `server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx.ts`. Reciben el hash (nunca el token) y el vencimiento ya calculados. El cliente es SIEMPRE el primer
 * parámetro, la transacción de quien llama (nunca `db = prisma` por defecto).
 */
type Tx = Prisma.TransactionClient;

/** El acceso (una sucursal, su rol y, si vinieron, sus notas) que pide una invitación de usuario. */
export interface AccesoDeLaInvitacion {
  sucursalId: string;
  rolId: string;
  notas?: string | null;
}

/** Suma la sucursal a la invitación, o le actualiza el rol (y las notas si vinieron) y quién la otorga, si ya la tenía. */
export async function sumarAccesoAInvitacion(tx: Tx, entrada: { empresaId: string; invitacionId: string; acceso: AccesoDeLaInvitacion; invitadoPorId: string }): Promise<void> {
  const { empresaId, invitacionId, acceso, invitadoPorId } = entrada;
  await tx.invitacionSucursal.upsert({
    where: { invitacionId_sucursalId: { invitacionId, sucursalId: acceso.sucursalId } },
    update: { rolId: acceso.rolId, invitadoPorId, ...(acceso.notas !== undefined && { notas: acceso.notas }) },
    create: { empresaId, invitacionId, sucursalId: acceso.sucursalId, rolId: acceso.rolId, invitadoPorId, ...(acceso.notas !== undefined && { notas: acceso.notas }) },
  });
}

/** Le pone a la invitación un token nuevo (su hash), un vencimiento nuevo y quién la firma, y la deja sin marca de envío (hay que mandar el mail de nuevo). */
export async function renovarTokenDeInvitacion(tx: Tx, entrada: { invitacionId: string; hashToken: string; venceEn: Date; invitadoPorId: string }): Promise<void> {
  await tx.invitacion.update({ where: { id: entrada.invitacionId }, data: { hashToken: entrada.hashToken, venceEn: entrada.venceEn, enviadaEn: null, invitadoPorId: entrada.invitadoPorId } });
}

/** Crea una invitación pendiente de ese tipo (`rolEmpresa`) para el email. Devuelve su id. */
export async function crearInvitacion(
  tx: Tx,
  entrada: { empresaId: string; email: string; tipo: "usuario" | "vinculacion"; hashToken: string; venceEn: Date; invitadoPorId: string },
): Promise<{ id: string }> {
  const { empresaId, email, tipo, hashToken, venceEn, invitadoPorId } = entrada;
  return tx.invitacion.create({ data: { empresaId, email, rolEmpresa: tipo, hashToken, venceEn, invitadoPorId } });
}

/** Vuelve a firmar TODAS las sucursales de la invitación a nombre de `invitadoPorId` (reenviar). */
export async function refirmarSucursalesDeInvitacion(tx: Tx, entrada: { invitacionId: string; invitadoPorId: string }): Promise<void> {
  await tx.invitacionSucursal.updateMany({ where: { invitacionId: entrada.invitacionId }, data: { invitadoPorId: entrada.invitadoPorId } });
}

/** Revoca la invitación SOLO si sigue pendiente (condicional: dos revocaciones simultáneas no se aplican las dos). Devuelve cuántas filas cambió. */
export async function revocarInvitacionSiSiguePendiente(tx: Tx, entrada: { invitacionId: string; ahora: Date }): Promise<number> {
  const r = await tx.invitacion.updateMany({ where: { id: entrada.invitacionId, estado: "PENDIENTE" }, data: { estado: "REVOCADA", revocadaEn: entrada.ahora } });
  return r.count;
}
