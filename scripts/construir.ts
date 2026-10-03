/**
 * Build de la app (`npm run build`): `prisma generate` + (según el modo de migración) + `next build`.
 *
 * El build NUNCA aplica migraciones por su cuenta (Tanda 7, 2026-10-02): aplicar una migración a una base es una decisión del dueño, no un
 * efecto secundario de compilar. Tres modos (`modoDeMigracionEnBuild`):
 *  - `verificar` (por defecto, local, gate y Producción de Vercel): corre `prisma migrate status`; con migraciones pendientes el build FALLA
 *    con el mensaje de cómo aprobarlas. Sin pendientes sigue igual que siempre.
 *  - `aplicar`: solo con `MOTOR2_MIGRAR_EN_BUILD=1`, puesto a propósito para UN deploy; corre `prisma migrate deploy`.
 *  - `omitir`: `MOTOR2_MIGRAR_EN_BUILD=0`, o un build de Vercel que no es de Producción (el Preview de `stockhneuquen` comparte la base de
 *    producción, ADR-007): no toca la base ni la mira.
 * La aprobación habitual es `npm run migrar:aprobar` contra la base de destino ANTES del deploy (docs/deploy-con-migraciones.md).
 */
import { spawnSync } from "node:child_process";

export type ModoDeMigracion = "aplicar" | "verificar" | "omitir";

export function modoDeMigracionEnBuild(env: Record<string, string | undefined>): ModoDeMigracion {
  if (env.MOTOR2_MIGRAR_EN_BUILD === "1") return "aplicar";
  if (env.MOTOR2_MIGRAR_EN_BUILD === "0") return "omitir";
  if (env.VERCEL && env.VERCEL_ENV !== "production") return "omitir";
  return "verificar";
}

export function mensajeDeMigracionesSinAprobar(): string {
  return [
    "[build] La base de destino tiene migraciones sin aplicar (o no se pudo consultar su estado): el build no las aplica solo.",
    "[build] Para aprobarlas, con DIRECT_URL apuntando a ESA base, corré `npm run migrar:aprobar` y después repetí el build/deploy.",
    "[build] Solo para un deploy puntual se puede poner MOTOR2_MIGRAR_EN_BUILD=1 (y sacarla después). Ver docs/deploy-con-migraciones.md.",
  ].join("\n");
}

function correr(comando: string): number {
  return spawnSync(comando, { shell: true, stdio: "inherit" }).status ?? 1;
}

function correrOSalir(comando: string): void {
  const estado = correr(comando);
  if (estado !== 0) process.exit(estado);
}

if (process.argv[1] && /construir\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  correrOSalir("npx prisma generate");
  const modo = modoDeMigracionEnBuild(process.env);
  if (modo === "aplicar") {
    console.log("[build] MOTOR2_MIGRAR_EN_BUILD=1: se aplican las migraciones pendientes (`prisma migrate deploy`).");
    correrOSalir("npx prisma migrate deploy");
  } else if (modo === "verificar") {
    if (correr("npx prisma migrate status") !== 0) {
      console.error(mensajeDeMigracionesSinAprobar());
      process.exit(1);
    }
  } else {
    console.log("[build] No se toca la base: MOTOR2_MIGRAR_EN_BUILD=" + (process.env.MOTOR2_MIGRAR_EN_BUILD ?? "(sin definir)") + ", VERCEL_ENV=" + (process.env.VERCEL_ENV ?? "(sin definir)") + ".");
  }
  correrOSalir("npx next build");
}
