import type { PrismaClient } from "@prisma/client";
import { clasificarCuentasDeGoogle, type CuentaDeGoogleSospechosa } from "../src/core/auth/cuentas-vinculadas";
import { medirPrecargados, type MedicionDePrecargados } from "../src/core/auth/precargados";

/**
 * Las dos lecturas (solo lectura) de los scripts de auditoría de cuentas: `npm run detectar-cuentas-vinculadas` y `npm run medir-precargados-sin-google`. Viven acá y no en
 * `src/server/` porque corren con `tsx`, donde `import "server-only"` revienta; la clasificación y la medición son puras y viven en `src/core/auth/` (Pureza Fase 3).
 */

/** Detección retroactiva del hallazgo S-01: usuarios con más de una cuenta de Google, o con una cuyo email firmado no es el suyo. */
export async function detectarCuentasDeGoogleSospechosas(db: Pick<PrismaClient, "user">): Promise<CuentaDeGoogleSospechosa[]> {
  const usuarios = await db.user.findMany({
    where: { accounts: { some: { provider: "google" } } },
    select: { id: true, email: true, accounts: { where: { provider: "google" }, select: { providerAccountId: true, id_token: true } } },
    orderBy: { email: "asc" },
  });
  return clasificarCuentasDeGoogle(usuarios);
}

/** Cuántos usuarios precargados todavía no entraron con Google (lo que cuesta apagar `allowDangerousEmailAccountLinking`). */
export async function medirPrecargadosSinGoogle(db: Pick<PrismaClient, "user">): Promise<MedicionDePrecargados> {
  const usuarios = await db.user.findMany({
    select: { email: true, activoGlobal: true, _count: { select: { accounts: { where: { provider: "google" } } } } },
    orderBy: { email: "asc" },
  });
  return medirPrecargados(usuarios.map((u) => ({ email: u.email, activoGlobal: u.activoGlobal, cuentasDeGoogle: u._count.accounts })));
}
