import { crearPrismaE2E, resetearBaseE2E, resolverUrlE2E, resolverUrlE2EB } from "./fixtures/base-e2e";

/**
 * Después de cada corrida de Playwright: la base E2E queda VACÍA. Es lo que
 * pide el pendiente ("no dejar residuos"): el reset previo (global-setup.ts)
 * asegura el arranque limpio, este asegura que no se acumule nada entre
 * corridas ni quede la base a medio uso.
 */
export default async function globalTeardown() {
  const base = resolverUrlE2E(process.env);
  const prismaE2E = crearPrismaE2E(base);
  try {
    const { filasAntes } = await resetearBaseE2E(prismaE2E);
    console.log(`[e2e] Reset final: ${filasAntes} filas generadas por la corrida, borradas. Base ${base.nombre} vacía.`);
  } finally {
    await prismaE2E.$disconnect();
  }
  const baseB = resolverUrlE2EB(process.env);
  if (baseB) {
    const prismaB = crearPrismaE2E(baseB);
    try {
      await resetearBaseE2E(prismaB);
    } finally {
      await prismaB.$disconnect();
    }
  }
}
