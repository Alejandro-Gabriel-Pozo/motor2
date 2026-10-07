import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { TipoDeInvitacion } from "@/core/features/empresa/invitacion";
import { actorEnSucursal, mensajeSiNoPuedeAsignarRol, mensajeSiNoPuedeGestionar, objetivoEnSucursal } from "@/core/permisos/gestion-de-usuarios";
import { requierePermiso } from "@/server/acceso/gate";

const TIPO_DE_USUARIO: TipoDeInvitacion = "usuario";

/** Lo que de quien actúa necesita el chequeo: su contexto (sucursal activa, rol de empresa, membresías) y el cliente de la empresa para el gate. */
export type ActorDeInvitacion = Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "rolEmpresa" | "membresias" | "db">;

export type InvitacionGestionable =
  | { ok: true; invitacion: { id: string; email: string; tipo: "usuario" | "vinculacion"; enviadaEn: Date | null } }
  | { ok: false; mensaje: string };

/**
 * PASO COMPARTIDO (sin ficha: lo componen los casos de uso de revocar y reenviar una invitación). Hito 3, Fase I, I.5g: antes era una función interna de
 * `src/server/actions/auth/usuarios.ts`, movida TAL CUAL (mismas lecturas, mismo orden, mismos mensajes).
 *
 * La invitación pendiente que esta persona puede gestionar desde la sucursal activa, o el motivo por el que no. Una de USUARIO se gestiona si incluye la sucursal activa,
 * y quien la toca tiene que poder otorgar CADA sucursal con su rol (gate por sucursal y techo de privilegio): si no, un administrador de una sucursal tocaría lo que dio
 * otro de otra. Una de VINCULACIÓN se gestiona si el usuario es miembro de la sucursal activa y el techo alcanza a esa persona.
 *
 * El gate de las OTRAS sucursales (`requierePermiso`, el real de `server/acceso/gate.ts`) se pide con `actor.db`, el cliente de la empresa, y NO con la transacción
 * `tx`, como siempre: la decisión de acceso no corre dentro de la transacción serializable de gobierno (no le suma lecturas ni conflictos, y la decide el mismo
 * guard que el resto de la aplicación). Lo fija `invitacion-gestionable-gate-con-db.test.ts`.
 */
export async function invitacionGestionable(actor: ActorDeInvitacion, tx: Prisma.TransactionClient, invitacionId: string): Promise<InvitacionGestionable> {
  const inv = await tx.invitacion.findFirst({
    where: { id: invitacionId, empresaId: actor.empresaId, estado: "PENDIENTE", rolEmpresa: { in: ["usuario", "vinculacion"] } },
    select: { id: true, email: true, rolEmpresa: true, enviadaEn: true, sucursales: { select: { sucursalId: true, rol: { select: { clave: true, activo: true } } } } },
  });
  if (!inv) return { ok: false, mensaje: "No se encontró esa invitación pendiente." };

  const tipoDeInvitacion: string = inv.rolEmpresa;
  if (tipoDeInvitacion === TIPO_DE_USUARIO) {
    if (!inv.sucursales.some((s) => s.sucursalId === actor.sucursalId)) return { ok: false, mensaje: "No se encontró esa invitación pendiente." };
    for (const fila of inv.sucursales) {
      if (fila.sucursalId !== actor.sucursalId) {
        const gate = await requierePermiso(actor.usuarioId, fila.sucursalId, "gestion_usuarios", actor.db);
        if (!gate.ok) return { ok: false, mensaje: "Esa invitación da acceso a sucursales donde no podés gestionar usuarios." };
      }
      const rechazo = mensajeSiNoPuedeAsignarRol(actorEnSucursal(actor, fila.sucursalId), fila.rol);
      if (rechazo) return { ok: false, mensaje: rechazo };
    }
    return { ok: true, invitacion: { id: inv.id, email: inv.email, tipo: "usuario", enviadaEn: inv.enviadaEn } };
  }

  const membresia = await tx.usuarioSucursal.findFirst({ where: { sucursalId: actor.sucursalId, usuario: { email: inv.email } }, select: { rol: { select: { clave: true } }, usuarioId: true } });
  if (!membresia) return { ok: false, mensaje: "No se encontró esa invitación pendiente." };
  const rechazo = mensajeSiNoPuedeGestionar(actorEnSucursal(actor, actor.sucursalId), await objetivoEnSucursal(tx, actor.empresaId, membresia.usuarioId, membresia.rol));
  if (rechazo) return { ok: false, mensaje: rechazo };
  return { ok: true, invitacion: { id: inv.id, email: inv.email, tipo: "vinculacion", enviadaEn: inv.enviadaEn } };
}
