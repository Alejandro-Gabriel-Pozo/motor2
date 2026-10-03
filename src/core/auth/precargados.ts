import type { PrismaClient } from "@prisma/client";

export interface MedicionDePrecargados {
  totalDeUsuarios: number;
  /** Usuarios con al menos una cuenta de Google vinculada: ya entraron alguna vez. */
  conGoogle: number;
  /** Usuarios precargados (los dio de alta un admin por email) que todavía no entraron con Google: los que `allowDangerousEmailAccountLinking` deja entrar. */
  precargadosSinGoogle: number;
  /** De los anteriores, los que no están desactivados a nivel sistema (`activoGlobal`): los que de verdad hay que migrar a invitaciones. */
  precargadosActivosSinGoogle: number;
  /** Emails de los precargados activos sin Google, ordenados (solo se imprimen con `--detalle`). */
  emailsPendientes: string[];
}

/**
 * Mide cuántos usuarios precargados todavía no entraron con Google (solo lectura). Es el número que dice cuánto cuesta apagar
 * `allowDangerousEmailAccountLinking`: cada uno es un usuario más a pasar a invitaciones antes de apagarlo.
 */
export async function medirPrecargadosSinGoogle(db: Pick<PrismaClient, "user">): Promise<MedicionDePrecargados> {
  const usuarios = await db.user.findMany({
    select: { email: true, activoGlobal: true, _count: { select: { accounts: { where: { provider: "google" } } } } },
    orderBy: { email: "asc" },
  });
  const sinGoogle = usuarios.filter((u) => u._count.accounts === 0);
  const activos = sinGoogle.filter((u) => u.activoGlobal);
  return {
    totalDeUsuarios: usuarios.length,
    conGoogle: usuarios.length - sinGoogle.length,
    precargadosSinGoogle: sinGoogle.length,
    precargadosActivosSinGoogle: activos.length,
    emailsPendientes: activos.map((u) => u.email),
  };
}
