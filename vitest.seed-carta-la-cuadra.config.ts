import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolverUrlDelSeed, verificarConfirmacionExplicita } from "./scripts/demo-seed/guardas-destino";

/**
 * Config separada para scripts/seed-demo-carta-la-cuadra.ts — mismo mecanismo que vitest.seed-6-meses.config.ts (las guardas
 * de destino corren ACÁ, al cargar este archivo, antes de que src/lib/db.ts cree el cliente Prisma real).
 *
 * Se corre a mano, DESPUÉS de sembrar el catálogo de "La Cuadra" (seed-demo-pizzeria.ts o seed-demo-pizzeria-6-meses.ts):
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *   MOTOR2_SEED_CONFIRMAR="si" \
 *     npx vitest run --config vitest.seed-carta-la-cuadra.config.ts
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
    include: ["scripts/seed-demo-carta-la-cuadra.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
