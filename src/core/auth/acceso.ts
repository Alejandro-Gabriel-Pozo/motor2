import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
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
export async function emailPuedeIniciarSesion(
  email: string,
  hd: string | undefined,
  db: PrismaClient = prisma
): Promise<boolean> {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return false;

  if (obtenerEmailsBootstrap().includes(emailNorm)) return true;

  const dominiosPermitidos = obtenerDominiosPermitidos();
  const dominioCuenta = (hd ?? emailNorm.split("@")[1] ?? "").toLowerCase();
  if (dominiosPermitidos.length > 0 && dominiosPermitidos.includes(dominioCuenta)) {
    return true;
  }

  const usuario = await db.user.findUnique({
    where: { email: emailNorm },
    include: { sucursales: { where: { activo: true }, take: 1 } },
  });
  return Boolean(usuario && usuario.sucursales.length > 0);
}
