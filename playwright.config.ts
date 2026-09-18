import { defineConfig } from "@playwright/test";

/**
 * E2E real: navegador de verdad contra `next dev` + Postgres real — ver
 * test/e2e/fixtures/auth.ts para cómo se resuelve la sesión sin Google
 * OAuth. Complementa (no reemplaza) los 355 tests de Vitest: esos cubren
 * lógica de negocio contra Postgres real pero SIN navegador (`environment:
 * "node"`, vitest.config.ts) — hay una clase entera de bugs (HTML
 * inválido, eventos del DOM, hidratación de React) que solo un navegador
 * real puede atrapar. Encontrado así, no por Vitest/tsc/eslint: el bug de
 * `<form>` anidado en QuickCrearProducto/QuickCrear (sesión 2026-09-17).
 *
 * `workers: 1` a propósito, mismo criterio que `fileParallelism: false`
 * de vitest.config.ts — los specs comparten la misma base Postgres real,
 * sin mocks; correr en paralelo abriría la puerta a carreras entre specs
 * hasta que cada uno garantice datos con nombres únicos.
 */
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
