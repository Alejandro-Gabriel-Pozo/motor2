import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Config separada a propósito para scripts/seed-demo-pizzeria.ts: reusa el
 * mismo mecanismo de vitest.config.ts (mocks de next/headers y sesión, para
 * poder llamar a los server actions reales — registrarMovimiento/
 * registrarVenta/registrarConteoFisico — fuera de un request real de
 * Next.js), pero con su propio `include` para que NUNCA se cuele en
 * `npx vitest run`/`npm test` (que usa vitest.config.ts, sin este archivo).
 * Se corre a mano: `npx vitest run --config vitest.seed.config.ts`.
 */
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
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
