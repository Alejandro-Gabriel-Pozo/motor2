/**
 * Cuántos usuarios precargados todavía no entraron con Google (solo lectura, no modifica nada), en la base que apunte DATABASE_URL. La lógica vive en
 * `src/core/auth/precargados.ts` (testeada). Es lo que cuesta apagar `allowDangerousEmailAccountLinking`: cada precargado hay que pasarlo a invitaciones.
 * `--detalle` lista además los emails pendientes (datos personales: no pegarlos en ningún chat ni ticket).
 *
 * Uso: npm run medir-precargados -- [--detalle]
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { medirPrecargadosSinGoogle } from "../src/core/auth/precargados";

async function main() {
  const m = await medirPrecargadosSinGoogle(prisma);
  console.log(`Usuarios: ${m.totalDeUsuarios}`);
  console.log(`  con Google (ya entraron):                 ${m.conGoogle}`);
  console.log(`  precargados sin Google:                   ${m.precargadosSinGoogle}`);
  console.log(`  de esos, activos (a migrar a invitación): ${m.precargadosActivosSinGoogle}`);
  if (process.argv.includes("--detalle")) for (const email of m.emailsPendientes) console.log(`    - ${email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
