/**
 * Cupo de los mails de invitación (S-21, plan de endurecimiento de seguridad): reglas puras, sin base ni reloj propio (`ahora` entra por parámetro).
 *
 * El canal de correo `avisos` tiene UN cupo diario del proveedor que comparten TODAS las empresas y los códigos de ingreso de la consola (ADR-018). Sin tope por empresa, una
 * sola (o un administrador con el mouse, o un script con una cuenta robada) podía mandar cientos de invitaciones —el único freno era uno por minuto y por invitación, con carrera—
 * y dejar a las demás, y a la consola, sin mail. Dos topes, contados sobre las últimas 24 horas y por EMPRESA (nunca entre empresas: una no puede gastar el de otra):
 *  - por empresa: cuántos mails de invitación en total;
 *  - por destinatario: cuántos a la misma dirección (un reenvío cuenta como mail nuevo: cada uno sale del cupo del proveedor).
 * Son defaults a confirmar por el dueño (decisión B12 del carril B), revertibles cambiando estas dos constantes.
 */
export const MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA = 50;
export const MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA = 3;
const VENTANA_DEL_CUPO_DE_CORREO_MS = 24 * 60 * 60 * 1000;

/** Cómo se anota cada mail reservado en la auditoría (`UsuarioEmpresa`, `entidadId` la invitación): el contador del cupo cuenta estas filas, una por mail. */
export const CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION = "mailDeInvitacion";

/** La descripción de la fila de auditoría de un mail: lleva la dirección en minúsculas, y por ella se cuenta cuántos salieron a la misma. */
export function descripcionDelMailDeInvitacion(email: string): string {
  return `Mail de la invitación a "${email.trim().toLowerCase()}"`;
}

/** Desde cuándo se cuentan los mails ya reservados: las últimas 24 horas respecto de la hora del pedido. */
export function desdeDelCupoDeCorreo(ahora: Date): Date {
  return new Date(ahora.getTime() - VENTANA_DEL_CUPO_DE_CORREO_MS);
}

export interface MailsDeInvitacionDelDia {
  /** Los de toda la empresa en la ventana. */
  deLaEmpresa: number;
  /** Los que salieron a ESTA dirección en la ventana. */
  delDestinatario: number;
}

/** El rechazo si el mail que se quiere reservar ya no entra en el cupo (cuenta el que se quiere mandar: con `deLaEmpresa` en el tope, el siguiente no sale), o `null`. */
export function mensajeSiNoHayCupoDeCorreo(usados: MailsDeInvitacionDelDia, email: string): string | null {
  if (usados.deLaEmpresa >= MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA) {
    return `Cupo de invitaciones agotado por hoy: la empresa ya mandó ${MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA} mails de invitación en las últimas 24 horas. Probá de nuevo mañana.`;
  }
  if (usados.delDestinatario >= MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA) {
    return `Cupo de invitaciones agotado por hoy para "${email}": ya se le mandaron ${MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA} mails en las últimas 24 horas. Probá de nuevo mañana.`;
  }
  return null;
}
