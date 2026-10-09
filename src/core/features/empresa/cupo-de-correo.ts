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

/**
 * La clave con la que el cupo por destinatario cuenta una dirección (M-22 de la auditoría intermedia): minúsculas y SIN el sufijo `+alias` de la parte local. `a+1@dominio` y `a+2@dominio`
 * llegan al mismo buzón, y contarlos aparte dejaba esquivar el tope por destinatario con alias (el tope por empresa seguía frenando, pero a 50 en vez de 3). Solo se corta en el primer `+`
 * de la parte local (la anterior al ÚLTIMO `@`); los puntos de gmail NO se tocan (no hay precedente en el proyecto, y en otros dominios el punto sí distingue buzones). Si cortar dejara la
 * parte local vacía (`+x@dominio`) se conserva la dirección entera: no se inventa un buzón.
 */
export function claveDeDestinatarioDelCupo(email: string): string {
  const minuscula = email.trim().toLowerCase();
  const arroba = minuscula.lastIndexOf("@");
  if (arroba <= 0) return minuscula;
  const local = minuscula.slice(0, arroba);
  const mas = local.indexOf("+");
  if (mas <= 0) return minuscula;
  return `${local.slice(0, mas)}${minuscula.slice(arroba)}`;
}

/**
 * La descripción de la fila de auditoría de un mail: lleva la dirección por su CLAVE del cupo (`claveDeDestinatarioDelCupo`), y por ella se cuenta cuántos salieron al mismo buzón. La
 * dirección completa (con su alias) sigue en la invitación y en su propia fila de auditoría; esta fila existe para contar. Las filas de ANTES de M-22 (con el alias a la vista) no se suman al
 * buzón sin alias: salen del conteo a las 24 horas, como todas.
 */
export function descripcionDelMailDeInvitacion(email: string): string {
  return `Mail de la invitación a "${claveDeDestinatarioDelCupo(email)}"`;
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

/**
 * Lo que ve quien pidió una invitación cuando la reserva del cupo se agotó por CONCURRENCIA (M-14 de la auditoría intermedia): la transacción de gobierno es SERIALIZABLE y, con muchas reservas
 * simultáneas en la misma empresa, Postgres aborta las que chocan (P2034) y se reintentan hasta un tope; si se agota, antes el error salía crudo (un «algo salió mal» sin relación con el cupo).
 * Ahora falla CERRADO con este texto: no se mandó ni se cambió nada (la transacción se deshizo entera) y se puede repetir enseguida.
 */
export const MENSAJE_DE_CUPO_DE_CORREO_POR_CONCURRENCIA =
  "No se pudo reservar el cupo de mails de invitación: hay demasiadas invitaciones saliendo a la vez en la empresa. No se mandó ni se cambió nada; esperá unos segundos y volvé a intentar.";

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
