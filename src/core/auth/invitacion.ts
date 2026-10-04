import { estadoEfectivoDeInvitacion, esTokenConFormaValida, type EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import { aceptarInvitacion, ErrorDeAceptacion, MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "@/core/features/empresa/aceptar-invitacion";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { InvarianteViolada } from "@/core/permisos/invariantes";
import { hashDeToken } from "@/core/seguridad/tokens";
import { dbDeInvitacion, transaccionDeEmpresa, verificarRolDeEjecucionDelProceso } from "./base";
import { sirvePorHttps } from "./cookie-sesion";

/**
 * Invitación del primer gerente, del lado de la app de empresas (E5, ADR-020). Acá se LEE por token: el invitado todavía no tiene empresa ni sesión
 * (o tiene una de otras empresas), así que se busca por el hash con `dbDeInvitacion` (política `lectura_por_token`). Aceptar vive en
 * `core/features/empresa/aceptar-invitacion.ts`.
 *
 * El token viaja en el fragmento del enlace; `abrirInvitacion` lo pasa a una cookie httpOnly para que sobreviva al ida y vuelta con Google. Esa
 * cookie es `SameSite=Lax` a propósito: con Strict no viajaría en el regreso desde accounts.google.com.
 */

const COOKIE_INVITACION_HTTP = "motor2.invitacion";
const COOKIE_INVITACION_HOST = "__Host-motor2.invitacion";
/** La cookie vive como mucho una hora (o hasta el vencimiento de la invitación, lo que ocurra antes). */
const VIDA_MAXIMA_COOKIE_INVITACION_S = 3600;

interface EntornoCookie {
  NODE_ENV?: string;
  VERCEL?: string;
  AUTH_URL?: string;
}

export function nombreCookieInvitacion(env: EntornoCookie): string {
  return sirvePorHttps(env) ? COOKIE_INVITACION_HOST : COOKIE_INVITACION_HTTP;
}

export function opcionesCookieInvitacion(env: EntornoCookie, venceEn: Date, ahora: Date) {
  const hastaElVencimiento = Math.floor((venceEn.getTime() - ahora.getTime()) / 1000);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: sirvePorHttps(env),
    maxAge: Math.max(0, Math.min(VIDA_MAXIMA_COOKIE_INVITACION_S, hastaElVencimiento)),
  };
}

/** Lo que la pantalla y el gate necesitan saber de una invitación. Nunca incluye el hash. */
export interface VistaDeInvitacion {
  id: string;
  empresaId: string;
  nombreEmpresa: string;
  estadoEmpresa: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  email: string;
  estado: EstadoEfectivoDeInvitacion;
  venceEn: Date;
}

/**
 * Busca la invitación por el token del enlace. `null` si el token no tiene la forma esperada o no corresponde a ninguna: el que llama no distingue
 * «no existe» de «mal formado», y de afuera tampoco.
 */
export async function invitacionDelToken(token: string | undefined, ahora: Date = new Date()): Promise<VistaDeInvitacion | null> {
  if (!token || !esTokenConFormaValida(token)) return null;
  await verificarRolDeEjecucionDelProceso();
  const db = dbDeInvitacion(hashDeToken(token));
  const invitacion = await db.invitacion.findFirst({
    select: { id: true, empresaId: true, email: true, estado: true, venceEn: true },
  });
  if (!invitacion) return null;
  const empresa = await db.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { nombre: true, estado: true } });
  if (!empresa) return null;
  return {
    id: invitacion.id,
    empresaId: invitacion.empresaId,
    nombreEmpresa: empresa.nombre,
    estadoEmpresa: empresa.estado,
    email: invitacion.email,
    estado: estadoEfectivoDeInvitacion(invitacion, ahora),
    venceEn: invitacion.venceEn,
  };
}

/**
 * ¿Esta invitación deja iniciar sesión con la cuenta de Google de `emailPerfil`? Sí cuando sigue pendiente (no aceptada, revocada ni vencida) y el email
 * es EL MISMO que se invitó. Es la cuarta vía del gate de login: no da acceso a nada más que a llegar a la pantalla de aceptación.
 */
export async function invitacionHabilitaElIngreso(token: string | undefined, emailPerfil: string, ahora: Date = new Date()): Promise<boolean> {
  const vista = await invitacionDelToken(token, ahora);
  if (!vista || vista.estado !== "PENDIENTE" || vista.estadoEmpresa !== "PROVISIONING") return false;
  return vista.email === emailPerfil.trim().toLowerCase();
}

/**
 * Acepta la invitación del token en nombre de `usuario` (ya autenticado con Google). Resuelve la empresa por el token y corre `aceptarInvitacion` en una
 * transacción serializable bajo esa empresa. Un fallo de invariantes o de datos de la empresa deshace todo y vuelve como mensaje.
 */
export async function aceptarInvitacionDelToken(entrada: { token: string; usuario: { id: string; email: string }; cuit: unknown; ahora?: Date }): Promise<ResultadoDeAceptacion> {
  const ahora = entrada.ahora ?? new Date();
  const vista = await invitacionDelToken(entrada.token, ahora);
  if (!vista || vista.estado !== "PENDIENTE") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  try {
    return await conTransaccionSerializable(
      (fn, opciones) => transaccionDeEmpresa(vista.empresaId, fn, opciones),
      (tx) => aceptarInvitacion(tx, { token: entrada.token, usuario: entrada.usuario, cuit: entrada.cuit, ahora }),
    );
  } catch (e) {
    if (e instanceof InvarianteViolada) return { ok: false, mensaje: e.mensaje };
    if (e instanceof ErrorDeAceptacion) return { ok: false, mensaje: e.message };
    throw e;
  }
}
