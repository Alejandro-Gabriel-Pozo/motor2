import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export function obtenerEmailsBootstrap(): string[] {
  return (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Bootstrap del primer admin del sistema (ver plan, "Bootstrap de admin sin
 * hueco de seguridad"). Se dispara en el evento signIn de Auth.js.
 *
 * Condición doble: (a) el email que hace login está en
 * BOOTSTRAP_ADMIN_EMAILS, Y (b) todavía no existe NINGÚN admin activo en
 * TODA la empresa (chequeo a nivel empresa, no por sucursal; la instalación
 * es multiempresa-capable pero hoy activa una sola, ADR-007). Reproduce la garantía de hoy (Core.js:892-898: solo
 * quien ya tenía acceso de Editor a la planilla podía ser "el primero") de
 * forma explícita en vez de implícita por orden de llegada.
 *
 * Una vez que existe un admin real, esta función deja de tener efecto — la
 * única vía para sumar gente pasa a ser la acción 'gestion_usuarios' (sumar
 * a alguien a una sucursal existente) o 'alta_sucursal' (crear una sucursal
 * nueva con su primer admin).
 */
export async function intentarBootstrapAdmin(
  usuarioId: string,
  email: string,
  db: PrismaClient = prisma
): Promise<void> {
  const emailsBootstrap = obtenerEmailsBootstrap();
  if (!emailsBootstrap.includes(email.trim().toLowerCase())) return;

  const yaHayAdmin = await db.usuarioSucursal.findFirst({
    where: { activo: true, rol: { nombre: "admin", activo: true } },
  });
  if (yaHayAdmin) return;

  const [rolAdmin, sucursal] = await Promise.all([
    db.rol.findFirst({ where: { nombre: "admin" } }),
    db.sucursal.findFirst({ where: { activo: true }, orderBy: { creadoEn: "asc" } }),
  ]);
  // Si el seed todavía no corrió no hay ni rol admin ni sucursal — no hay
  // dónde hacer bootstrap todavía; no es un error, solo "esperar al seed".
  if (!rolAdmin || !sucursal) return;

  await db.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId: sucursal.id } },
    update: { rolId: rolAdmin.id, activo: true },
    create: {
      usuarioId,
      sucursalId: sucursal.id,
      rolId: rolAdmin.id,
      notas: "Alta automática por bootstrap (BOOTSTRAP_ADMIN_EMAILS).",
    },
  });
}
