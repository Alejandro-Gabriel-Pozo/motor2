import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { resolverUrlDelSeed } from "./scripts/demo-seed/guardas-destino";

/**
 * Proyecto Playwright PROPIO para la demo de 6 meses (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo 5:
 * "proyecto Playwright propio con axe sobre todas las pantallas") — deliberadamente SEPARADO de playwright.config.ts:
 *
 * - Corre contra `motor2_demo` (los datos reales de 6 meses de "La Cuadra"), NUNCA contra `motor2_e2e` — mismo motivo que
 *   scripts/seed-demo-pizzeria-6-meses.ts tiene su propio carril: mezclar bases sería mezclar guardas y objetivos.
 * - NO vacía la base antes ni después (`test/e2e-demo/global-setup-demo.ts` solo VERIFICA que "La Cuadra" ya esté sembrada,
 *   nunca la toca) — a diferencia de `test/e2e/global-setup.ts`, acá la base sembrada es lo que se está auditando.
 * - Puerto propio (3102, ni el 3000 de dev ni el 3101 de E2E) y `reuseExistingServer: false`, mismo motivo que
 *   playwright.config.ts.
 *
 * Objetivo de esta corrida: barrer TODAS las pantallas (misma lista de rutas que test/e2e/maquetacion-general.spec.ts) con
 * datos REALES de 6 meses — a diferencia de los specs de axe normales (test/e2e/accesibilidad.spec.ts), que siembran el caso
 * mínimo necesario para auditar un componente puntual, esto confirma que ninguna pantalla se rompe (error boundary) ni viola
 * axe cuando la carga real de datos de la demo (cientos de filas, avisos con datos de verdad, "· parcial"/"· reconstruido")
 * la atraviesa entera.
 *
 * Uso: MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *        npx playwright test --config playwright.demo.config.ts
 */
const base = resolverUrlDelSeed(process.env);
process.env.DATABASE_URL = base.url;
process.env.DIRECT_URL = base.url;

const PUERTO = 3102;
const URL_BASE = `http://localhost:${PUERTO}`;

export default defineConfig({
  testDir: "./test/e2e-demo",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./test/e2e-demo/global-setup-demo.ts",
  use: {
    baseURL: URL_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build:e2e && npm run start:e2e",
    env: {
      DATABASE_URL: base.url,
      DIRECT_URL: base.url,
      PORT: String(PUERTO),
      MOTOR2_SIN_DOLAR_AUTOMATICO: "1",
      AUTH_TRUST_HOST: "1",
    },
    url: URL_BASE,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
  },
});
