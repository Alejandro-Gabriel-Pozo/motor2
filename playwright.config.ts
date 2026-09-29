import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { resolverUrlAppE2E, resolverUrlE2E } from "./test/e2e/fixtures/base-e2e";
import { TOKEN_CARTA_E2E } from "./test/e2e/fixtures/carta-token";

/**
 * E2E real: navegador de verdad contra el servidor de producción (`next build` + `next start`, ver `MOTOR2_E2E_SERVIDOR` más abajo) + Postgres real — ver
 * test/e2e/fixtures/auth.ts para cómo se resuelve la sesión sin Google
 * OAuth. Complementa (no reemplaza) los tests de Vitest: esos cubren
 * lógica de negocio contra Postgres real pero SIN navegador (`environment:
 * "node"`, vitest.config.ts) — hay una clase entera de bugs (HTML
 * inválido, eventos del DOM, hidratación de React) que solo un navegador
 * real puede atrapar. Encontrado así, no por Vitest/tsc/eslint: el bug de
 * `<form>` anidado en QuickCrearProducto/QuickCrear (sesión 2026-09-17).
 *
 * BASE DE DATOS DEDICADA: los E2E corren contra `MOTOR2_E2E_DATABASE_URL` (el DUEÑO: reset y migraciones) y
 * `MOTOR2_E2E_APP_DATABASE_URL` (el rol `motor2_app` del runtime, misma base; ADR-007 A0)
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
const baseApp = resolverUrlAppE2E(process.env);
// ADR-007 (A0): el runtime (servidor y specs, `src/lib/db.ts`) usa el rol sin privilegios `motor2_app`; migrar y resetear (dueño) va por DIRECT_URL.
process.env.DATABASE_URL = baseApp.url;
process.env.DIRECT_URL = base.url;

// Puerto propio de ESTE worktree (feat/promo-combo, Task #16): 56471, distinto de los ya tomados por ramas
// anteriores en este mismo sandbox compartido (48213, 45677, 47391, 53219 — ver el historial de este archivo). No
// es una decisión de producto — la app no expone nada real en este puerto — así que se corrige acá, sin tocar
// ningún otro worktree.
const PUERTO = Number(process.env.MOTOR2_E2E_PUERTO ?? 56471);
const URL_BASE = `http://localhost:${PUERTO}`;

/**
 * QUÉ SERVIDOR levanta el E2E, elegido con `MOTOR2_E2E_SERVIDOR`:
 *  - `build`: compila el artefacto de producción (`npm run build:e2e`, SIN `prisma migrate deploy`) y lo sirve con `next start`. Es lo que se despliega.
 *  - `start`: reusa el último build (`next start`) sin recompilar: ciclo corto para depurar un spec cuando el código no cambió.
 *  - `dev`: `next dev`, con overlay de errores y HMR (el modo anterior).
 *
 * `NODE_ENV=production` vive SOLO dentro del proceso del servidor (`next start` lo fija); el proceso de Playwright nunca lo tiene, y por eso la guarda de
 * base-e2e.ts que rechaza `NODE_ENV=production` sigue intacta. El build hereda `DATABASE_URL`/`DIRECT_URL` de la base E2E (webServer.env): aunque algo
 * consultara datos al compilar, solo podría llegar a `motor2_e2e`, nunca a `motor2_dev` ni a Neon. Y las guardas de `resolverUrlE2E` corren al cargar
 * ESTE archivo, antes de que Playwright arranque el webServer: una base mal configurada aborta antes de pagar un solo segundo de build.
 */
const COMANDOS = {
  build: "npm run build:e2e && npm run start:e2e",
  start: "npm run start:e2e",
  dev: "npm run dev",
} as const;
type ModoServidor = keyof typeof COMANDOS;
const modoPedido = process.env.MOTOR2_E2E_SERVIDOR?.trim() || "build";
if (!(modoPedido in COMANDOS)) throw new Error(`MOTOR2_E2E_SERVIDOR inválido: "${modoPedido}". Valores: ${Object.keys(COMANDOS).join(" | ")}.`);
const MODO = modoPedido as ModoServidor;
// El modo YA RESUELTO (con el default aplicado) se exporta al entorno: es la fuente de verdad que lee test/e2e/servidor-en-modo-produccion.spec.ts.
process.env.MOTOR2_E2E_SERVIDOR = MODO;
// Playwright reimporta este archivo en cada worker (TEST_WORKER_INDEX definido): el modo se imprime una sola vez, desde el proceso principal.
if (process.env.TEST_WORKER_INDEX === undefined) console.log(`[e2e] Servidor: ${MODO} (${COMANDOS[MODO]})`);

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
    command: COMANDOS[MODO],
    env: {
      DATABASE_URL: baseApp.url,
      DIRECT_URL: base.url,
      PORT: String(PUERTO),
      // Las pruebas no deben pedir el dólar a internet ni depender de él (ver actualizarDolarSiHaceFalta).
      MOTOR2_SIN_DOLAR_AUTOMATICO: "1",
      // `next start` deja NODE_ENV=production y Auth.js entonces exige confianza EXPLÍCITA en el host
      // (@auth/core/lib/utils/env.js: trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? NODE_ENV !== "production")). Sin esto cada auth() devuelve
      // UntrustedHost y se cae toda la suite autenticada. En `dev` no cambia nada. El nombre de la cookie de sesión tampoco cambia (http → sin prefijo __Secure-).
      AUTH_TRUST_HOST: "1",
      // Token de servicio de los endpoints de la carta pública (GET /api/carta/[sucursal] y /api/carta/tenants); lo usan test/e2e/api-carta*.spec.ts.
      CARTA_API_TOKEN: TOKEN_CARTA_E2E,
      // ADR-006, Fase 6: con esto next.config.ts arma el rewrite de carta.e2e.localhost (se lee al compilar, por eso está en el env del build); lo usa test/e2e/carta-subdominio.spec.ts.
      CARTA_DOMINIO_BASE: "localhost",
    },
    url: URL_BASE,
    reuseExistingServer: false,
    // En `build` el timeout cubre el build ENTERO + el arranque; `stdout: "pipe"` deja ver avanzar el build (el stderr ya se imprime siempre).
    timeout: MODO === "build" ? 300_000 : 60_000,
    stdout: MODO === "build" ? "pipe" : undefined,
  },
});
