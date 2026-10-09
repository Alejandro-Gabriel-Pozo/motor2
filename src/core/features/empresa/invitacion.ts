import type { MensajeDeCorreo } from "@/core/correo/tipos";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";

/**
 * Invitación del primer gerente (E5, ADR-020): reglas puras, sin base ni reloj propio (`ahora` entra por parámetro para poder probarlas).
 * El token se genera con `core/seguridad/tokens`; acá solo se decide su vida, su forma, su enlace y el texto del mail.
 */

/** Vida del enlace (propuesta del dueño, 2026-10-03): 7 días desde que se crea o se reenvía. */
export const VIDA_DE_LA_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

export type EstadoDeInvitacion = "PENDIENTE" | "ACEPTADA" | "REVOCADA";
export type EstadoEfectivoDeInvitacion = EstadoDeInvitacion | "VENCIDA";

export function vencimientoDeInvitacion(ahora: Date): Date {
  return new Date(ahora.getTime() + VIDA_DE_LA_INVITACION_MS);
}

/** «Vencida» no se guarda: es una pendiente cuyo `venceEn` ya pasó. Una sola fuente de verdad, sin cron. */
export function estadoEfectivoDeInvitacion(invitacion: { estado: EstadoDeInvitacion; venceEn: Date }, ahora: Date): EstadoEfectivoDeInvitacion {
  if (invitacion.estado === "PENDIENTE" && invitacion.venceEn.getTime() <= ahora.getTime()) return "VENCIDA";
  return invitacion.estado;
}

/** Un token de 32 bytes en base64url mide 43 caracteres: lo demás ni se busca en la base. */
export function esTokenConFormaValida(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** El token viaja en el fragmento (`#t=`): no llega a los logs del servidor ni al `Referer`, y abrir el enlace no gasta la invitación. */
export function enlaceDeInvitacion(urlApp: string, token: string): string {
  return `${urlApp.replace(/\/+$/, "")}/invitacion#t=${token}`;
}

/** Lee el token del fragmento de la URL (`#t=...`); `null` si no está o no tiene la forma esperada. */
export function tokenDelFragmento(fragmento: string): string | null {
  const valor = new URLSearchParams(fragmento.replace(/^#/, "")).get("t");
  return valor !== null && esTokenConFormaValida(valor) ? valor : null;
}

/** El mail de la invitación. El token aparece solo dentro del enlace; nunca el hash. */
export function mensajeDeInvitacion(datos: { email: string; nombreEmpresa: string; enlace: string; venceEn: Date; zonaHoraria: string }): MensajeDeCorreo {
  const vence = formatearFechaHora(datos.venceEn, datos.zonaHoraria);
  const texto = [
    `Te invitaron a ser gerente de «${datos.nombreEmpresa}».`,
    "",
    `Para aceptar, abrí este enlace e ingresá con la cuenta de Google de ${datos.email} (tiene que ser esa misma):`,
    datos.enlace,
    "",
    `El enlace se puede usar una sola vez y vence el ${vence}.`,
    "Si no esperabas este mail, ignoralo.",
  ].join("\n");
  return { para: [datos.email], asunto: `Invitación para ser gerente de ${datos.nombreEmpresa}`, texto };
}

// ---- Invitación de usuario y de vinculación (E8, ADR-024) ----

/** Los tres tipos de invitación (columna `rolEmpresa`): el primer gerente (E5), sumar a alguien a una empresa y vincular la cuenta de Google de un usuario precargado. */
export type TipoDeInvitacion = "gerente" | "usuario" | "vinculacion";

/** Qué hacer con la invitación pendiente de un email al asegurar una de usuario o de vinculación. */
export type DecisionSobreLaPendiente = { accion: "crear" } | { accion: "extender" } | { accion: "rotar" } | { accion: "rechazar"; mensaje: string };

/**
 * La decisión PURA de `asegurarInvitacionDeUsuario` / `asegurarInvitacionDeVinculacion` (Hito 3, I.5e2: antes en línea en cada una) sobre la invitación pendiente
 * que ya tiene ese email, en ESTE orden: de otro tipo → no se puede (con el mensaje de cada tipo); vigente (vence después de `ahora`) → extender; vencida → rotar
 * el token; ninguna → crear. `pendiente.tipo` es la columna `rolEmpresa` de la invitación (su tipo, no un rol de nadie). El email ya viene en minúsculas.
 */
export function decidirSobreLaInvitacionPendiente(
  pendiente: { tipo: string; venceEn: Date } | null,
  pedida: Extract<TipoDeInvitacion, "usuario" | "vinculacion">,
  email: string,
  ahora: Date,
): DecisionSobreLaPendiente {
  if (pendiente && pendiente.tipo !== pedida) {
    return {
      accion: "rechazar",
      mensaje:
        pedida === "usuario"
          ? `Ya hay una invitación pendiente para ${email} que no es de usuario. Revocala o esperá a que se acepte.`
          : `Ya hay una invitación pendiente para ${email} que no es de vinculación.`,
    };
  }
  if (pendiente && pendiente.venceEn.getTime() > ahora.getTime()) return { accion: "extender" };
  if (pendiente) return { accion: "rotar" };
  return { accion: "crear" };
}

/** Un reenvío por minuto como máximo por invitación: acota el mail (el cupo del proveedor es compartido con los códigos de la plataforma). */
const ESPERA_ENTRE_REENVIOS_MS = 60_000;

/**
 * El freno de un minuto entre dos envíos de la misma invitación (reenviar, invitar a vincular): el rechazo si la última salió hace menos de un minuto respecto de la hora
 * del pedido, o `null`. Hito 3, I.5h: antes eran dos constantes y la misma comparación en línea en `usuarios.ts`; mismo texto y mismo borde (exactamente un minuto ya
 * deja reenviar). Sin marca de envío (`null`, nunca salió) no frena.
 */
export function mensajeSiSeReenviaMuyPronto(enviadaEn: Date | null | undefined, ahora: Date): string | null {
  return enviadaEn && ahora.getTime() - enviadaEn.getTime() < ESPERA_ENTRE_REENVIOS_MS ? "Esa invitación se envió hace menos de un minuto. Esperá un momento antes de reenviarla." : null;
}

/** Una sucursal con el rol que da una invitación, tal como se muestra en el mail y en la pantalla. */
export interface AccesoDeInvitacion {
  sucursal: string;
  rol: string;
}

/** La dirección pública de la app (`AUTH_URL`): https, o http solo en localhost. Sin barra final. `null` si no está o no sirve: sin ella no se arma ningún enlace (nunca desde el `Host`). */
export function urlPublicaDeLaApp(valor: string | undefined): string | null {
  if (!valor) return null;
  try {
    const u = new URL(valor);
    if (u.search !== "" || u.hash !== "" || u.pathname.replace(/\/+$/, "") !== "") return null;
    const permitido = u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
    return permitido ? valor.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/** El mail de una invitación de USUARIO: quién la hizo, a qué sucursales y con qué rol. El token aparece solo dentro del enlace. */
export function mensajeDeInvitacionDeUsuario(datos: { email: string; nombreEmpresa: string; emailDeQuienInvita: string; accesos: readonly AccesoDeInvitacion[]; enlace: string; venceEn: Date; zonaHoraria: string }): MensajeDeCorreo {
  const vence = formatearFechaHora(datos.venceEn, datos.zonaHoraria);
  const texto = [
    `${datos.emailDeQuienInvita} te dio acceso a «${datos.nombreEmpresa}»:`,
    ...datos.accesos.map((a) => `  - ${a.sucursal} (${a.rol})`),
    "",
    `Para aceptar, abrí este enlace e ingresá con la cuenta de Google de ${datos.email} (tiene que ser esa misma):`,
    datos.enlace,
    "",
    `El enlace se puede usar una sola vez y vence el ${vence}.`,
    "Si no esperabas este mail, ignoralo.",
  ].join("\n");
  return { para: [datos.email], asunto: `Te dieron acceso a ${datos.nombreEmpresa}`, texto };
}

/** El mail de una invitación de VINCULACIÓN: la persona ya está dada de alta y solo tiene que entrar por primera vez con su cuenta de Google. */
export function mensajeDeInvitacionDeVinculacion(datos: { email: string; nombreEmpresa: string; enlace: string; venceEn: Date; zonaHoraria: string }): MensajeDeCorreo {
  const vence = formatearFechaHora(datos.venceEn, datos.zonaHoraria);
  const texto = [
    `Tu usuario de «${datos.nombreEmpresa}» ya está dado de alta.`,
    "",
    `Para entrar por primera vez, abrí este enlace e ingresá con la cuenta de Google de ${datos.email} (tiene que ser esa misma):`,
    datos.enlace,
    "",
    `El enlace se puede usar una sola vez y vence el ${vence}.`,
    "Si no esperabas este mail, ignoralo.",
  ].join("\n");
  return { para: [datos.email], asunto: `Entrá a ${datos.nombreEmpresa}`, texto };
}
