import { prisma } from "../../src/lib/db";
import { resolverUrlDelSeed } from "../../scripts/demo-seed/guardas-destino";

const NOMBRE_SUCURSAL = "La Cuadra";

/**
 * A diferencia de test/e2e/global-setup.ts (que VACÍA la base antes de cada corrida), esto NUNCA toca los datos — la demo de
 * 6 meses es lo que se está auditando, no algo para resetear. Solo confirma que la base es la correcta (mismo mecanismo de
 * guarda que el seed y las invariantes) y que la sucursal existe, para fallar rápido y claro si alguien corre esto contra
 * una base vacía en vez de una ya sembrada.
 */
export default async function globalSetupDemo() {
  const base = resolverUrlDelSeed(process.env);
  console.log(`[e2e-demo] Base: ${base.host}/${base.nombre}`);

  if (process.env.DATABASE_URL !== base.url) {
    throw new Error("DATABASE_URL no coincide con MOTOR2_SEED_DATABASE_URL: la app arrancaría apuntando a otra base que la auditada.");
  }

  const sucursal = await prisma.sucursal.findFirst({ where: { nombre: NOMBRE_SUCURSAL } });
  if (!sucursal) {
    throw new Error(`No existe la sucursal "${NOMBRE_SUCURSAL}" en "${base.nombre}" — corré scripts/seed-demo-pizzeria-6-meses.ts primero.`);
  }
  const operaciones = await prisma.operacion.count({ where: { sucursalId: sucursal.id } });
  console.log(`[e2e-demo] Sucursal "${NOMBRE_SUCURSAL}": ${operaciones} operaciones ya sembradas — sin tocar nada.`);
  await prisma.$disconnect();
}
