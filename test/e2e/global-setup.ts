import { prisma } from "../../src/lib/db";
import { asegurarBaseSeed } from "./fixtures/auth";
import { crearPrismaE2E, resetearBaseE2E, resolverUrlAppE2E, resolverUrlE2E } from "./fixtures/base-e2e";

/**
 * Antes de cada corrida de Playwright: base E2E vacía + seed mínimo.
 *
 * El seed no es opcional: reportes-consolidado-promociones-categorias.spec.ts
 * hace `findUniqueOrThrow` de la sucursal "Central" y del rol "admin" SIN pasar
 * por la fixture de auth, así que con una base vacía revienta al correrlo solo
 * (p. ej. con `--grep`). Ver test/e2e/fixtures/base-e2e.ts para las guardas.
 */
export default async function globalSetup() {
  const base = resolverUrlE2E(process.env);
  console.log(`[e2e] Base E2E: ${base.host}/${base.nombre}`);

  // La app y los specs tienen que estar en LA MISMA base que se acaba de
  // validar: playwright.config.ts la fija en DATABASE_URL antes de llegar acá.
  const baseApp = resolverUrlAppE2E(process.env);
  if (process.env.DATABASE_URL !== baseApp.url || process.env.DIRECT_URL !== base.url) {
    throw new Error("DATABASE_URL/DIRECT_URL no coinciden con MOTOR2_E2E_APP_DATABASE_URL/MOTOR2_E2E_DATABASE_URL: los specs escribirían en otra base que la que se limpia o con el rol equivocado.");
  }

  const prismaE2E = crearPrismaE2E(base);
  try {
    const { filasAntes, detalleAntes } = await resetearBaseE2E(prismaE2E);
    console.log(`[e2e] Reset previo: ${filasAntes} filas residuales borradas${filasAntes ? ` (${JSON.stringify(detalleAntes)})` : ""}.`);
  } finally {
    await prismaE2E.$disconnect();
  }

  await asegurarBaseSeed();
  await prisma.$disconnect();
}
