/**
 * Build de la app (`npm run build`): `prisma generate` + `prisma migrate deploy` + `next build`. En Vercel, `migrate deploy` solo corre
 * en builds de Producción (`VERCEL_ENV=production`): un Preview de una rama cualquiera no puede aplicar migraciones, y en `stockhneuquen`
 * el Preview comparte la base de producción (ADR-007). Fuera de Vercel (local, gate) migra siempre, como antes. `MOTOR2_MIGRAR_EN_BUILD`
 * (`1`/`0`) fuerza la decisión en cualquier entorno.
 */
import { spawnSync } from "node:child_process";

export function debeMigrarEnBuild(env: Record<string, string | undefined>): boolean {
  if (env.MOTOR2_MIGRAR_EN_BUILD === "1") return true;
  if (env.MOTOR2_MIGRAR_EN_BUILD === "0") return false;
  if (!env.VERCEL) return true;
  return env.VERCEL_ENV === "production";
}

function correr(comando: string): void {
  const r = spawnSync(comando, { shell: true, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.argv[1] && /construir\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  correr("npx prisma generate");
  if (debeMigrarEnBuild(process.env)) {
    correr("npx prisma migrate deploy");
  } else {
    console.log("[build] Se omite `prisma migrate deploy`: build de Vercel que no es de Producción (VERCEL_ENV=" + process.env.VERCEL_ENV + ").");
  }
  correr("npx next build");
}
