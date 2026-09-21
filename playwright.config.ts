import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { resolverUrlE2E } from "./test/e2e/fixtures/base-e2e";

/**
 * E2E real: navegador de verdad contra `next dev` + Postgres real — ver
 * test/e2e/fixtures/auth.ts para cómo se resuelve la sesión sin Google
 * OAuth. Complementa (no reemplaza) los tests de Vitest: esos cubren
 * lógica de negocio contra Postgres real pero SIN navegador (`environment:
 * "node"`, vitest.config.ts) — hay una clase entera de bugs (HTML
 * inválido, eventos del DOM, hidratación de React) que solo un navegador
 * real puede atrapar. Encontrado así, no por Vitest/tsc/eslint: el bug de
 * `<form>` anidado en QuickCrearProducto/QuickCrear (sesión 2026-09-17).
 *
 * BASE DE DATOS DEDICADA: los E2E corren contra `MOTOR2_E2E_DATABASE_URL`
 * (una base LOCAL cuyo nombre termina en "_e2e", validada por
 * `resolverUrlE2E` — ver test/e2e/fixtures/base-e2e.ts), nunca contra la de
 * desarrollo. `globalSetup` la deja vacía + seed mínimo antes de cada
 * corrida y `globalTeardown` la vacía al terminar, así que no se acumulan
 * datos entre corridas. Los specs siguen usando nombres únicos con
 * `Date.now()` (ya no hace falta para no chocar entre corridas, sí para no
 * chocar entre specs de la MISMA corrida).
 *
 * `process.env.DATABASE_URL` se fija acá, a nivel de módulo, porque
 * Playwright re-importa este archivo en cada worker: así los specs (que
 * importan `prisma` de src/lib/db.ts) y el servidor que levanta `webServer`
 * hablan con la MISMA base sin tocar cada spec. `dotenv` no pisa variables ya
 * definidas, así que el `import "dotenv/config"` de fixtures/auth.ts no lo
 * revierte.
 *
 * Servidor en puerto propio (3101) y `reuseExistingServer: false`: un
 * `next dev` que el desarrollador tenga abierto en el 3000 apunta a
 * `motor2_dev`; reutilizarlo haría correr los specs contra la base equivocada.
 *
 * `workers: 1` a propósito, mismo criterio que `fileParallelism: false`
 * de vitest.config.ts — los specs comparten la misma base Postgres real,
 * sin mocks; correr en paralelo abriría la puerta a carreras entre specs
 * hasta que cada uno garantice datos con nombres únicos.
 */
const base = resolverUrlE2E(process.env);
process.env.DATABASE_URL = base.url;
process.env.DIRECT_URL = base.url;

const PUERTO = 3101;
const URL_BASE = `http://localhost:${PUERTO}`;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",
  use: {
    baseURL: URL_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: {
      DATABASE_URL: base.url,
      DIRECT_URL: base.url,
      PORT: String(PUERTO),
      // Las pruebas no deben pedir el dólar a internet ni depender de él (ver actualizarDolarSiHaceFalta).
      MOTOR2_SIN_DOLAR_AUTOMATICO: "1",
    },
    url: URL_BASE,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
