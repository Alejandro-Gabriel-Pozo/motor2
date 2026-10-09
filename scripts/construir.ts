/**
 * Build de la app (`npm run build`): `prisma generate` + (según el modo de migración) + `next build`.
 *
 * El build NUNCA aplica migraciones por su cuenta (Tanda 7, 2026-10-02): aplicar una migración a una base es una decisión del dueño, no un
 * efecto secundario de compilar. Cuatro modos (`modoDeMigracionEnBuild`):
 *  - `verificar` (por defecto, local, gate y Producción de Vercel): corre `prisma migrate status`; con migraciones pendientes el build FALLA
 *    con el mensaje de cómo aprobarlas. Sin pendientes, verifica además el registro de módulos (solo lectura, `verificar-registro-de-modulos.ts`):
 *    una empresa activa anterior a la migración sin registro hace fallar el build. Sigue igual que siempre si todo está en orden.
 *  - `aplicar`: solo con `MOTOR2_MIGRAR_EN_BUILD=1` en local o en un build de PRODUCCIÓN de Vercel, puesto a propósito para UN deploy; corre `prisma migrate deploy`.
 *  - `rechazar` (S-31): `MOTOR2_MIGRAR_EN_BUILD=1` en un build de Vercel que NO es de Producción: el build falla antes de tocar nada (no migra la base de producción desde un Preview).
 *  - `omitir`: `MOTOR2_MIGRAR_EN_BUILD=0`, o un build de Vercel que no es de Producción (el Preview de `stockhneuquen` comparte la base de
 *    producción, ADR-007): no toca la base ni la mira.
 * La aprobación habitual es `npm run migrar:aprobar` contra la base de destino ANTES del deploy (docs/deploy-con-migraciones.md).
 */
import { spawnSync } from "node:child_process";

export type ModoDeMigracion = "aplicar" | "verificar" | "omitir" | "rechazar";

/**
 * S-31: en Vercel decide `VERCEL_ENV`, y se mira ANTES que la variable de aprobación. Un build de Vercel que no es de Producción (Preview, Development) comparte la base de producción
 * (ADR-007): un entorno menos confiable nunca ejecuta con el privilegio de uno más confiable. `MOTOR2_MIGRAR_EN_BUILD=1` ahí no migra: el build se RECHAZA (no se la ignora en silencio,
 * para que quien la puso creyendo que servía se entere). La aprobación de una migración sigue siendo `npm run migrar:aprobar`, o la variable en un build de Producción.
 */
export function modoDeMigracionEnBuild(env: Record<string, string | undefined>): ModoDeMigracion {
  if (env.VERCEL && env.VERCEL_ENV !== "production") return env.MOTOR2_MIGRAR_EN_BUILD === "1" ? "rechazar" : "omitir";
  if (env.MOTOR2_MIGRAR_EN_BUILD === "1") return "aplicar";
  if (env.MOTOR2_MIGRAR_EN_BUILD === "0") return "omitir";
  return "verificar";
}

export function mensajeDeMigracionRechazadaFueraDeProduccion(): string {
  return [
    "[build] MOTOR2_MIGRAR_EN_BUILD=1 en un build de Vercel que NO es de Producción: el build se rechaza.",
    "[build] Los Preview comparten la base de Producción (ADR-007) y un entorno menos confiable no puede migrarla. Sacá la variable de este entorno.",
    "[build] Para aplicar migraciones, con DIRECT_URL apuntando a la base de destino corré `npm run migrar:aprobar` antes del deploy. Ver docs/deploy-con-migraciones.md.",
  ].join("\n");
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
  const modo = modoDeMigracionEnBuild(process.env);
  if (modo === "rechazar") {
    console.error(mensajeDeMigracionRechazadaFueraDeProduccion());
    process.exit(1);
  }
  correrOSalir("npx prisma generate");
  if (modo === "aplicar") {
    console.log("[build] MOTOR2_MIGRAR_EN_BUILD=1: se aplican las migraciones pendientes (`prisma migrate deploy`).");
    correrOSalir("npx prisma migrate deploy");
  } else if (modo === "verificar") {
    if (correr("npx prisma migrate status") !== 0) {
      console.error(mensajeDeMigracionesSinAprobar());
      process.exit(1);
    }
    correrOSalir("npx tsx scripts/verificar-registro-de-modulos.ts");
  } else {
    console.log("[build] No se toca la base: MOTOR2_MIGRAR_EN_BUILD=" + (process.env.MOTOR2_MIGRAR_EN_BUILD ?? "(sin definir)") + ", VERCEL_ENV=" + (process.env.VERCEL_ENV ?? "(sin definir)") + ".");
  }
  correrOSalir("npx next build");
}
