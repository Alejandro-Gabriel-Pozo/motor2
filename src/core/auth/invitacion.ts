import { estadoEfectivoDeInvitacion, esTokenConFormaValida, type EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import { aceptarInvitacion, ErrorDeAceptacion, MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "@/core/features/empresa/aceptar-invitacion";
import { conTransaccionSerializable, esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
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
/** El tipo de la invitación de E5 (primer gerente de una empresa en alta). Es un tipo de invitación, no una decisión de acceso. */
const TIPO_INVITACION_GERENTE = "gerente";
const TIPO_INVITACION_USUARIO = "usuario";
const TIPO_INVITACION_VINCULACION = "vinculacion";

export interface VistaDeInvitacion {
  id: string;
  empresaId: string;
  nombreEmpresa: string;
  estadoEmpresa: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  email: string;
  /** El tipo de invitación (columna `rolEmpresa`): hoy solo `gerente`; E8 suma `usuario` y `vinculacion`. */
  tipo: string;
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
  const hash = hashDeToken(token);
  const db = dbDeInvitacion(hash);
  // Por hash y no solo por el RLS: sin `where`, un token bien formado pero inexistente devolvería OTRA fila visible (por ejemplo la de la única empresa activa).
  const invitacion = await db.invitacion.findFirst({
    where: { hashToken: hash },
    select: { id: true, empresaId: true, email: true, rolEmpresa: true, estado: true, venceEn: true },
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
    tipo: invitacion.rolEmpresa,
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
  if (!vista || vista.estado !== "PENDIENTE" || !abreLaVia3(vista)) return false;
  return vista.email === emailPerfil.trim().toLowerCase();
}

/** La vía 3 la abren la invitación de gerente (empresa en alta) y la de usuario (empresa activa). La de vinculación NO abre nada: el ingreso lo decide la vía 2. */
function abreLaVia3(vista: Pick<VistaDeInvitacion, "tipo" | "estadoEmpresa">): boolean {
  return (vista.tipo === TIPO_INVITACION_GERENTE && vista.estadoEmpresa === "PROVISIONING") || (vista.tipo === TIPO_INVITACION_USUARIO && vista.estadoEmpresa === "ACTIVE");
}

/** Una invitación sirve para VINCULAR la cuenta de Google si es de gerente (en alta), de usuario (activa) o de vinculación (activa). */
function sirveParaVincular(vista: Pick<VistaDeInvitacion, "tipo" | "estadoEmpresa">): boolean {
  return abreLaVia3(vista) || (vista.tipo === TIPO_INVITACION_VINCULACION && vista.estadoEmpresa === "ACTIVE");
}

/** Los campos que Auth.js guardaría de la cuenta de Google (`defaultAccount`): el `id_token` en particular lo lee el detector de cuentas ajenas (S-01). */
export interface CuentaDeGoogle {
  providerAccountId: string;
  type?: string | undefined;
  access_token?: string | null | undefined;
  refresh_token?: string | null | undefined;
  id_token?: string | null | undefined;
  expires_at?: number | null | undefined;
  scope?: string | null | undefined;
  token_type?: string | null | undefined;
  session_state?: string | null | undefined;
}

/**
 * Vincula la cuenta de Google al `User` EXISTENTE, con el token de una invitación (E8, ADR-024). Auth.js no lo hace solo (el enlace automático por email está apagado):
 * el callback `signIn` corre ANTES de que Auth.js busque o cree nada, así que si acá queda creada la `Account`, Auth.js la encuentra y abre la sesión.
 *
 * Condiciones (todas): invitación pendiente y no vencida de un tipo y una empresa que sirvan; el email de la invitación es EXACTAMENTE el del usuario; el usuario no tiene
 * otra cuenta de Google (con otro identificador NO se vincula nada: lo resuelve soporte, D2). La de vinculación se consume al vincular; las de gerente y de usuario no (las
 * consume la aceptación después). Idempotente si la cuenta ya es la de ese usuario. Devuelve `false` ante cualquier condición que falle.
 */
export async function vincularCuentaConInvitacion(entrada: { token: string | undefined; usuario: { id: string; email: string }; cuenta: CuentaDeGoogle; ahora?: Date }): Promise<boolean> {
  const ahora = entrada.ahora ?? new Date();
  const vista = await invitacionDelToken(entrada.token, ahora);
  if (!vista || vista.estado !== "PENDIENTE" || !sirveParaVincular(vista)) return false;
  if (vista.email !== entrada.usuario.email.trim().toLowerCase()) return false;
  const { cuenta, usuario } = entrada;
  try {
    return await conTransaccionSerializable(
      (fn, opciones) => transaccionDeEmpresa(vista.empresaId, fn, opciones),
      async (tx) => {
        const previa = await tx.account.findFirst({ where: { userId: usuario.id, provider: "google" }, select: { providerAccountId: true } });
        if (previa) return previa.providerAccountId === cuenta.providerAccountId;
        if (vista.tipo === TIPO_INVITACION_VINCULACION) {
          const consumida = await tx.invitacion.updateMany({
            where: { id: vista.id, estado: "PENDIENTE", rolEmpresa: TIPO_INVITACION_VINCULACION },
            data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: usuario.id },
          });
          if (consumida.count !== 1) return false;
          await registrarCambioAuditado(tx, {
            entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "cuentaGoogle", descripcion: `Cuenta de Google de "${vista.email}"`,
            valorAnterior: null, valorNuevo: "vinculada", actorId: usuario.id, sucursalId: null,
          });
        }
        await tx.account.create({
          data: {
            userId: usuario.id, type: cuenta.type ?? "oidc", provider: "google", providerAccountId: cuenta.providerAccountId,
            ...(cuenta.access_token != null && { access_token: cuenta.access_token }),
            ...(cuenta.refresh_token != null && { refresh_token: cuenta.refresh_token }),
            ...(cuenta.id_token != null && { id_token: cuenta.id_token }),
            ...(cuenta.expires_at != null && { expires_at: cuenta.expires_at }),
            ...(cuenta.scope != null && { scope: cuenta.scope }),
            ...(cuenta.token_type != null && { token_type: cuenta.token_type }),
            ...(cuenta.session_state != null && { session_state: cuenta.session_state }),
          },
        });
        return true;
      },
      undefined,
      undefined,
      true,
    );
  } catch (e) {
    if (e instanceof InvarianteViolada) return false;
    if (esChoqueDeIndiceUnico(e)) return false;
    throw e;
  }
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
