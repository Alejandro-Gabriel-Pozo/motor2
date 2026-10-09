import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolverUrlDelSeed, verificarConfirmacionExplicita } from "./scripts/demo-seed/guardas-destino";

/**
 * Config separada a propósito para scripts/seed-demo-pizzeria.ts: reusa el
 * mismo mecanismo de vitest.config.ts (mocks de next/headers y sesión, para
 * poder llamar a los server actions reales — registrarMovimiento/
 * registrarVenta/registrarConteoFisico — fuera de un request real de
 * Next.js), pero con su propio `include` para que NUNCA se cuele en
 * `npx vitest run`/`npm test` (que usa vitest.config.ts, sin este archivo).
 *
 * S-33: pasa por las MISMAS guardas de destino que los otros seeds (`scripts/demo-seed/guardas-destino.ts`: host local, base con sufijo "_demo", confirmación explícita), que
 * corren ACÁ al cargar el archivo, antes de que `src/lib/db.ts` cree el cliente. Antes sembraba 30 días de movimientos en la base que dijera `DATABASE_URL` (el `.env`, que puede ser cualquiera).
 * Se corre a mano:
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *   MOTOR2_SEED_CONFIRMAR="si" \
 *     npx vitest run --config vitest.seed.config.ts
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
    include: ["scripts/seed-demo-pizzeria.ts"],
    testTimeout: 1_500_000,
    hookTimeout: 1_500_000,
  },
});
