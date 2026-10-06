/**
 * Detección retroactiva del hallazgo S-01 (solo lectura, no modifica nada): lista los usuarios con más de una cuenta de Google vinculada o
 * con una cuenta cuyo email no es el suyo, en la base que apunte DATABASE_URL. La lectura vive en `scripts/lecturas-de-auth.ts` y la clasificación en `src/core/auth/cuentas-vinculadas.ts` (testeadas).
 *
 * Uso: npm run detectar-cuentas-vinculadas
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { detectarCuentasDeGoogleSospechosas } from "./lecturas-de-auth";

async function main() {
  const sospechosos = await detectarCuentasDeGoogleSospechosas(prisma);
  if (sospechosos.length === 0) {
    console.log("Sin hallazgos: ningún usuario tiene más de una cuenta de Google ni una cuenta de otro email.");
    return;
  }
  console.log(`${sospechosos.length} usuario(s) para revisar:`);
  for (const s of sospechosos) {
    console.log(`\n- ${s.usuarioEmail} (${s.usuarioId}) — ${s.motivos.join(", ")}`);
    for (const c of s.cuentas) console.log(`    cuenta de Google ${c.providerAccountId}: email ${c.emailEnLaCuenta ?? "(no consta)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
