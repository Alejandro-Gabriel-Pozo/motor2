import type { PrismaClient } from "@prisma/client";

/**
 * Quién puede figurar como autor de un cambio de plataforma hecho por script (`scripts/modulos-empresa.ts`, `scripts/politica-empresa.ts`): un administrador de plataforma ACTIVO
 * (`AdminPlataforma`, los que entran a la consola con doble factor), no cualquier cuenta de la app. Antes `--actor` era un texto libre que solo tenía que existir como `User`, y la
 * auditoría atribuía el cambio de módulos o de política de una empresa a quien fuera. SOLO la plataforma lee `AdminPlataforma` (política `solo_plataforma`), así que se llama con el
 * cliente de plataforma, ANTES de la operación (que sigue corriendo con cualquier cliente en los tests). El mensaje es el mismo exista o no el email, esté activo o no.
 */
export class ActorDePlataformaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ActorDePlataformaError";
  }
}

export async function requerirAdminDePlataforma(db: PrismaClient, email: string): Promise<{ id: string; email: string }> {
  const normalizado = email.trim().toLowerCase();
  const admin = await db.adminPlataforma.findUnique({ where: { email: normalizado }, select: { id: true, email: true, activo: true } });
  if (!admin || !admin.activo) {
    throw new ActorDePlataformaError(`"${email}" no es un administrador de plataforma activo: solo ellos pueden hacer este cambio, que queda a su nombre en la auditoría.`);
  }
  return { id: admin.id, email: admin.email };
}
