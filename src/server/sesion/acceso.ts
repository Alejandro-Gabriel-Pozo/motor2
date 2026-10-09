import "server-only";
import { prisma } from "@/lib/db";
import { dbDeEmpresa, dbDeUsuario } from "@/core/auth/base";
import type { CuentaDeGoogle } from "@/core/auth/invitacion";
import { invitacionHabilitaElIngreso } from "./invitacion";
import { vincularCuentaConInvitacion } from "./vincular-cuenta";

/**
 * El GATE DE LOGIN (Hito 3, B3-2 de `docs/plan-hito-3-pureza.md`; O.24): vivía en `core/auth/acceso.ts` y no era núcleo (lee la base con el `prisma` global y por empresa y el reloj).
 * Es infraestructura de sesión y lo usa solo `lib/auth.ts` (el callback `signIn` de Auth.js): nace con él `server/sesion/`, la capa del login
 * previa al contexto de empresa (ADR-024). Su reloj (`new Date()` de la sesión abierta y la hora que les pasa a la invitación y a la vinculación, que desde B3-9 la reciben
 * obligatoria: es el ÚNICO reloj de `server/sesion`) queda DECLARADO hasta la Fase 6 en `test/arquitectura/server-sesion.test.ts`; lo que la capa no puede importar lo fija la
 * regla `sesion-capa` de `.dependency-cruiser.cjs`. Ya no lee el entorno: desde S-17 (T8 del endurecimiento, D5 del dueño) no hay vía por dominio de correo.
 */

/**
 * Gate de login (ver callback signIn en src/lib/auth.ts): decide si un
 * email puede siquiera crear sesión, ANTES de que el adapter toque la DB.
 * Sin esto, cualquier cuenta de Google que apriete "Sign in" queda logueada
 * (sin permisos, pero logueada) aunque nadie la haya dado de alta.
 *
 * D5 (S-17): en este sistema NO existen usuarios sin empresa. Sin membresía activa ni invitación pendiente no hay sesión, venga de donde venga la cuenta de Google. La vía que
 * dejaba entrar a cualquiera del dominio de Google Workspace de la empresa (el claim `hd` contra `ALLOWED_EMAIL_DOMAINS`) se retiró: era una cuenta con sesión y sin empresa,
 * que no alcanzaba datos pero sí creaba un `User` y una `Session` y llegaba a toda puerta que mire «hacia afuera» de la empresa.
 *
 * Vías de entrada, en orden:
 *  1. Membresía: el email ya es de alguien con cuenta de empresa y sucursal activas
 *     (UsuarioSucursal activo vía agregarOActualizarUsuario o por haber aceptado una invitación), aunque no sea
 *     del dominio de la empresa — para alguien externo con Gmail personal.
 *  2. Invitación (E5, ADR-020): llega con el token de una invitación de gerente PENDIENTE, no vencida, de una empresa en alta, y el email de
 *     la cuenta de Google es EXACTAMENTE el invitado. Solo deja llegar a la pantalla de aceptación; el kill-switch de arriba sigue mandando.
 */
export async function emailPuedeIniciarSesion(email: string, tokenDeInvitacion?: string): Promise<boolean> {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return false;

  // Kill-switch (User.activoGlobal) primero, independiente de las vías
  // de entrada de abajo — si no fuera lo primero, alguien desactivado a
  // nivel cuenta pero cuyo email sigue teniendo membresía podría seguir
  // entrando sin que el kill-switch aplicara nunca. Un usuario que todavía
  // no existe (login nuevo) no tiene fila que consultar acá — no lo bloquea.
  const usuarioExistente = await prisma.user.findUnique({ where: { email: emailNorm } });
  if (usuarioExistente && !usuarioExistente.activoGlobal) return false;

  if (usuarioExistente && (await tieneSucursalActiva(usuarioExistente.id))) return true;

  return invitacionHabilitaElIngreso(tokenDeInvitacion, emailNorm, new Date());
}

function normalizar(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Gate completo de `signIn` (src/lib/auth.ts). Además de `emailPuedeIniciarSesion`, cierra la vinculación de cuentas de Google ajenas:
 *  - `emailUsuario` es el del `User` que Auth.js va a usar y `emailPerfil` el de la cuenta de Google que acaba de autenticarse. Si
 *    difieren, la cuenta de Google no es la dueña de ese usuario (una cuenta vinculada de más, o un email cambiado): no entra.
 *  - Con una sesión abierta de OTRO email, Auth.js vincularía esta cuenta de Google al usuario de la sesión (`handleLoginOrRegister`)
 *    y esa persona quedaría con el acceso del otro para siempre. Hay que cerrar la sesión antes de entrar con otra cuenta.
 */
export async function inicioDeSesionPermitido(entrada: {
  emailUsuario: string;
  emailPerfil: string;
  tokenDeSesionAbierta: string | undefined;
  /** Token de la cookie de invitación (E5), si la hay. */
  tokenDeInvitacion?: string | undefined;
}): Promise<boolean> {
  const emailUsuario = normalizar(entrada.emailUsuario);
  if (!emailUsuario || emailUsuario !== normalizar(entrada.emailPerfil)) return false;

  if (entrada.tokenDeSesionAbierta) {
    const abierta = await prisma.session.findUnique({
      where: { sessionToken: entrada.tokenDeSesionAbierta },
      select: { expires: true, user: { select: { email: true } } },
    });
    if (abierta && abierta.expires > new Date() && normalizar(abierta.user.email) !== emailUsuario) return false;
  }

  return emailPuedeIniciarSesion(emailUsuario, entrada.tokenDeInvitacion);
}

/**
 * Este chequeo corre ANTES de tener una empresa (login), así que no hay contexto de donde sacar `db`. `User` no tiene RLS (se
 * lee con `prisma`); `UsuarioEmpresa` sí y se lee con `dbDeUsuario` (sus pertenencias propias); `UsuarioSucursal` también, y se consulta por cada empresa del usuario bajo su propio contexto. Solo cuentan
 * las empresas donde su `UsuarioEmpresa` está activa: es la misma condición con la que `obtenerContextoUsuario` le da contexto.
 */
async function tieneSucursalActiva(usuarioId: string): Promise<boolean> {
  const pertenencias = await dbDeUsuario(usuarioId).usuarioEmpresa.findMany({ where: { usuarioId, activo: true }, select: { empresaId: true } });
  const conSucursal = await Promise.all(
    pertenencias.map(async ({ empresaId }) => Boolean(await dbDeEmpresa(empresaId).usuarioSucursal.findFirst({ where: { usuarioId, activo: true }, select: { id: true } })))
  );
  return conSucursal.some(Boolean);
}

/**
 * Lo que el callback `signIn` de Auth.js hace con el resultado: `true` entra, `false` rechaza y una ruta relativa redirige (por ejemplo a `/login` con un aviso).
 */
export type DecisionDeInicio = boolean | string;

/**
 * Decisión completa de `signIn` con el enlace automático de cuentas por email APAGADO (E8, ADR-024). Primero el gate de siempre (`inicioDeSesionPermitido`: email verificado,
 * kill-switch, sesión abierta de otro email, membresía o invitación). Después, según el usuario que Auth.js va a usar:
 *  - no existe: entra (Auth.js lo crea junto con su cuenta, sin conflicto);
 *  - ya tiene esa cuenta de Google: entra;
 *  - tiene otra cuenta de Google (mismo email, otro identificador): NO entra (`cuenta-distinta`, lo resuelve soporte);
 *  - existe y no tiene Google: solo entra si el token de una invitación sirve para vincular la cuenta, y la vincula acá (`falta-invitacion` si no).
 */
export async function decidirInicioDeSesion(entrada: {
  emailUsuario: string;
  emailPerfil: string;
  emailVerificado: boolean;
  tokenDeSesionAbierta: string | undefined;
  tokenDeInvitacion: string | undefined;
  cuenta: CuentaDeGoogle | null | undefined;
}): Promise<DecisionDeInicio> {
  if (!entrada.emailVerificado || !entrada.cuenta) return false;
  // Cuenta desactivada en toda la plataforma (kill-switch): se explica en vez de mostrar el «acceso denegado» genérico. Quien llega probó que controla ese email con Google.
  const desactivada = await prisma.user.findUnique({ where: { email: normalizar(entrada.emailUsuario) }, select: { activoGlobal: true } });
  if (desactivada && !desactivada.activoGlobal) return "/login?aviso=cuenta-desactivada";
  const permitido = await inicioDeSesionPermitido({
    emailUsuario: entrada.emailUsuario, emailPerfil: entrada.emailPerfil, tokenDeSesionAbierta: entrada.tokenDeSesionAbierta, tokenDeInvitacion: entrada.tokenDeInvitacion,
  });
  if (!permitido) return false;

  const usuario = await prisma.user.findUnique({ where: { email: normalizar(entrada.emailUsuario) }, select: { id: true, email: true, accounts: { where: { provider: "google" }, select: { providerAccountId: true } } } });
  if (!usuario) return true;
  if (usuario.accounts.some((a) => a.providerAccountId === entrada.cuenta!.providerAccountId)) return true;
  if (usuario.accounts.length > 0) return "/login?aviso=cuenta-distinta";
  const vinculada = await vincularCuentaConInvitacion({ token: entrada.tokenDeInvitacion, usuario: { id: usuario.id, email: usuario.email }, cuenta: entrada.cuenta, ahora: new Date() });
  return vinculada ? true : "/login?aviso=falta-invitacion";
}
