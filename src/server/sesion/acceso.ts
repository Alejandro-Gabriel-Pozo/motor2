import "server-only";
import { prisma } from "@/lib/db";
import { dbDeEmpresa, dbDeUsuario } from "@/core/auth/base";
import { invitacionHabilitaElIngreso, vincularCuentaConInvitacion, type CuentaDeGoogle } from "@/core/auth/invitacion";

/**
 * El GATE DE LOGIN (Hito 3, B3-2 de `docs/plan-hito-3-pureza.md`; O.24): vivía en `core/auth/acceso.ts` y no era núcleo (lee la base con el `prisma` global y por empresa, el reloj y
 * `process.env.ALLOWED_EMAIL_DOMAINS`). Es infraestructura de sesión y lo usa solo `lib/auth.ts` (el callback `signIn` de Auth.js): nace con él `server/sesion/`, la capa del login
 * previa al contexto de empresa (ADR-024). Su reloj (`new Date()` de la sesión abierta) y su entorno (`ALLOWED_EMAIL_DOMAINS`) quedan DECLARADOS hasta la Fase 6 en
 * `test/arquitectura/server-sesion.test.ts`; lo que la capa no puede importar lo fija la regla `sesion-capa` de `.dependency-cruiser.cjs`.
 */
function obtenerDominiosPermitidos(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Gate de login (ver callback signIn en src/lib/auth.ts): decide si un
 * email puede siquiera crear sesión, ANTES de que el adapter toque la DB.
 * Sin esto, cualquier cuenta de Google que apriete "Sign in" queda logueada
 * (sin permisos, pero logueada) aunque nadie la haya dado de alta.
 *
 * Vías de entrada, en orden:
 *  1. Dominio de Google Workspace: el claim `hd` del profile matchea
 *     ALLOWED_EMAIL_DOMAINS — cualquiera de la empresa entra, aunque un
 *     admin todavía no lo haya dado de alta a mano en ninguna sucursal.
 *     El claim `hd` es OBLIGATORIO para esta vía: solo Google lo firma para una cuenta
 *     administrada por ese dominio. Una cuenta personal de Google puede tener como email
 *     un `@dominio-de-la-empresa` (sin ser de la empresa) y no trae `hd`; el sufijo del email
 *     no prueba nada. Por eso ALLOWED_EMAIL_DOMAINS solo sirve para dominios de Workspace
 *     (`gmail.com` no tiene `hd`: ese caso entra por la vía 3).
 *  2. Excepción manual: el email ya fue dado de alta por un admin
 *     (UsuarioSucursal activo vía agregarOActualizarUsuario) aunque no sea
 *     del dominio de la empresa — para alguien externo con Gmail personal.
 *  3. Invitación (E5, ADR-020): llega con el token de una invitación de gerente PENDIENTE, no vencida, de una empresa en alta, y el email de
 *     la cuenta de Google es EXACTAMENTE el invitado. Solo deja llegar a la pantalla de aceptación; el kill-switch de arriba sigue mandando.
 */
export async function emailPuedeIniciarSesion(email: string, hd: string | undefined, tokenDeInvitacion?: string): Promise<boolean> {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return false;

  // Kill-switch (User.activoGlobal) primero, independiente de las 3 vías
  // de entrada de abajo — si no fuera lo primero, alguien desactivado a
  // nivel cuenta pero cuyo email sigue matcheando BOOTSTRAP_ADMIN_EMAILS o
  // ALLOWED_EMAIL_DOMAINS podría seguir entrando por esas vías sin que el
  // kill-switch aplicara nunca. Un usuario que todavía no existe (login
  // nuevo) no tiene fila que consultar acá — no lo bloquea.
  const usuarioExistente = await prisma.user.findUnique({ where: { email: emailNorm } });
  if (usuarioExistente && !usuarioExistente.activoGlobal) return false;

  const dominiosPermitidos = obtenerDominiosPermitidos();
  if (hd && dominiosPermitidos.includes(hd.trim().toLowerCase())) return true;

  if (usuarioExistente && (await tieneSucursalActiva(usuarioExistente.id))) return true;

  return invitacionHabilitaElIngreso(tokenDeInvitacion, emailNorm);
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
  hd: string | undefined;
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

  return emailPuedeIniciarSesion(emailUsuario, entrada.hd, entrada.tokenDeInvitacion);
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
 * kill-switch, sesión abierta de otro email, vías 1 a 3). Después, según el usuario que Auth.js va a usar:
 *  - no existe: entra (Auth.js lo crea junto con su cuenta, sin conflicto);
 *  - ya tiene esa cuenta de Google: entra;
 *  - tiene otra cuenta de Google (mismo email, otro identificador): NO entra (`cuenta-distinta`, lo resuelve soporte);
 *  - existe y no tiene Google: solo entra si el token de una invitación sirve para vincular la cuenta, y la vincula acá (`falta-invitacion` si no).
 */
export async function decidirInicioDeSesion(entrada: {
  emailUsuario: string;
  emailPerfil: string;
  emailVerificado: boolean;
  hd: string | undefined;
  tokenDeSesionAbierta: string | undefined;
  tokenDeInvitacion: string | undefined;
  cuenta: CuentaDeGoogle | null | undefined;
}): Promise<DecisionDeInicio> {
  if (!entrada.emailVerificado || !entrada.cuenta) return false;
  // Cuenta desactivada en toda la plataforma (kill-switch): se explica en vez de mostrar el «acceso denegado» genérico. Quien llega probó que controla ese email con Google.
  const desactivada = await prisma.user.findUnique({ where: { email: normalizar(entrada.emailUsuario) }, select: { activoGlobal: true } });
  if (desactivada && !desactivada.activoGlobal) return "/login?aviso=cuenta-desactivada";
  const permitido = await inicioDeSesionPermitido({
    emailUsuario: entrada.emailUsuario, emailPerfil: entrada.emailPerfil, hd: entrada.hd, tokenDeSesionAbierta: entrada.tokenDeSesionAbierta, tokenDeInvitacion: entrada.tokenDeInvitacion,
  });
  if (!permitido) return false;

  const usuario = await prisma.user.findUnique({ where: { email: normalizar(entrada.emailUsuario) }, select: { id: true, email: true, accounts: { where: { provider: "google" }, select: { providerAccountId: true } } } });
  if (!usuario) return true;
  if (usuario.accounts.some((a) => a.providerAccountId === entrada.cuenta!.providerAccountId)) return true;
  if (usuario.accounts.length > 0) return "/login?aviso=cuenta-distinta";
  const vinculada = await vincularCuentaConInvitacion({ token: entrada.tokenDeInvitacion, usuario: { id: usuario.id, email: usuario.email }, cuenta: entrada.cuenta });
  return vinculada ? true : "/login?aviso=falta-invitacion";
}
