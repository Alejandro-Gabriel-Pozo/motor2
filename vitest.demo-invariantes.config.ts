import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolverUrlDelSeed } from "./scripts/demo-seed/guardas-destino";

/**
 * Config separada para scripts/verificar-demo-invariantes.ts (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md,
 * "12 conciliaciones de dominio... es la parte que funciona como 'test E2E de todo el proyecto'").
 *
 * Es de SOLO LECTURA (nunca escribe), pero igual pasa por `resolverUrlDelSeed` (mismo mecanismo que
 * vitest.seed-6-meses.config.ts, mismo motivo: fijar `DATABASE_URL` ANTES de que `src/lib/db.ts` cree el cliente
 * Prisma) — así nunca corre por accidente contra Neon ni contra `motor2_dev`, ni siquiera para leer. NO pide
 * `MOTOR2_SEED_CONFIRMAR` (esa guarda es "antes de escribir"; acá no se escribe nada).
 *
 * Se corre contra la MISMA base que ya sembró scripts/seed-demo-pizzeria-6-meses.ts:
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *     npx vitest run --config vitest.demo-invariantes.config.ts
 */
const base = resolverUrlDelSeed(process.env);
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
    include: ["scripts/verificar-demo-invariantes.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
