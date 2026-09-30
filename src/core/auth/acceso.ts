import { prisma } from "@/lib/db";
import { dbDeEmpresa } from "./base";
import { obtenerEmailsBootstrap } from "./bootstrap";

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
 * Tres vías de entrada, en orden:
 *  1. Email en BOOTSTRAP_ADMIN_EMAILS — arranca el primer admin (ver
 *     intentarBootstrapAdmin), independiente del dominio.
 *  2. Dominio de Google Workspace: el claim `hd` del profile (o el sufijo
 *     del email si `hd` no vino, p.ej. cuentas no-Workspace) matchea
 *     ALLOWED_EMAIL_DOMAINS — cualquiera de la empresa entra, aunque un
 *     admin todavía no lo haya dado de alta a mano en ninguna sucursal.
 *  3. Excepción manual: el email ya fue dado de alta por un admin
 *     (UsuarioSucursal activo vía agregarOActualizarUsuario) aunque no sea
 *     del dominio de la empresa — para alguien externo con Gmail personal.
 */
export async function emailPuedeIniciarSesion(email: string, hd: string | undefined): Promise<boolean> {
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

  if (obtenerEmailsBootstrap().includes(emailNorm)) return true;

  const dominiosPermitidos = obtenerDominiosPermitidos();
  const dominioCuenta = (hd ?? emailNorm.split("@")[1] ?? "").toLowerCase();
  if (dominiosPermitidos.length > 0 && dominiosPermitidos.includes(dominioCuenta)) {
    return true;
  }

  return usuarioExistente ? tieneSucursalActiva(usuarioExistente.id) : false;
}

/**
 * Este chequeo corre ANTES de tener una empresa (login), así que no hay contexto de donde sacar `db`. `User` y `UsuarioEmpresa` no
 * tienen RLS (se leen con `prisma`); `UsuarioSucursal` sí, y se consulta por cada empresa del usuario bajo su propio contexto. Solo cuentan
 * las empresas donde su `UsuarioEmpresa` está activa: es la misma condición con la que `obtenerContextoUsuario` le da contexto.
 */
async function tieneSucursalActiva(usuarioId: string): Promise<boolean> {
  const pertenencias = await prisma.usuarioEmpresa.findMany({ where: { usuarioId, activo: true }, select: { empresaId: true } });
  const conSucursal = await Promise.all(
    pertenencias.map(async ({ empresaId }) => Boolean(await dbDeEmpresa(empresaId).usuarioSucursal.findFirst({ where: { usuarioId, activo: true }, select: { id: true } })))
  );
  return conSucursal.some(Boolean);
}
