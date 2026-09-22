import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolverUrlDelSeed, verificarConfirmacionExplicita } from "./scripts/demo-seed/guardas-destino";

/**
 * Config separada para scripts/seed-demo-pizzeria-6-meses.ts (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md).
 *
 * Las guardas de destino (host local, sufijo "_demo", confirmación explícita — `scripts/demo-seed/guardas-destino.ts`)
 * corren ACÁ, al cargar este archivo — ANTES de que `src/lib/db.ts` cree el cliente Prisma real, que lee
 * `process.env.DATABASE_URL` en el momento en que se importa (mismo mecanismo, y mismo motivo, que
 * `playwright.config.ts` fija `DATABASE_URL` a nivel de módulo antes de levantar el webServer). Si la URL no pasa la
 * guarda, esto lanza ANTES de que el script del seed llegue a conectarse a nada.
 *
 * `MOTOR2_SEED_DATABASE_URL`/`MOTOR2_SEED_CONFIRMAR`/`MOTOR2_SEED_REHACER` (ver .env.example): nunca vienen de
 * `DATABASE_URL` a secas — sembrar 6 meses de datos reales sobre la base equivocada por un fallback silencioso es
 * exactamente el accidente que esto existe para impedir. Se corre a mano:
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *   MOTOR2_SEED_CONFIRMAR="si" \
 *     npx vitest run --config vitest.seed-6-meses.config.ts
 */
const base = resolverUrlDelSeed(process.env);
verificarConfirmacionExplicita(process.env);
process.env.DATABASE_URL = base.url;
process.env.DIRECT_URL = base.url;

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/setup/server-only-stub.ts"),
      "next/headers": path.resolve(__dirname, "test/setup/next-headers-stub.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["scripts/seed-demo-pizzeria-6-meses.ts"],
    testTimeout: 3_000_000,
    hookTimeout: 3_000_000,
  },
});
