import path from "node:path";
import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `import "server-only"` revienta fuera del bundler de Next (que
      // define la condición `react-server`) — acá los server actions se
      // importan directo bajo Node/Vitest, sin ese boundary. El paquete
      // solo existe para tirar un error en tiempo de build si un Client
      // Component lo importa; en tests no hay Client Components, así que
      // se reemplaza por un módulo vacío (mismo criterio recomendado por
      // Next.js para testear código server-only con Vitest/Jest).
      "server-only": path.resolve(__dirname, "test/setup/server-only-stub.ts"),
      // `cookies()` real revienta fuera de un request de Next.js — ver
      // test/setup/next-headers-stub.ts.
      "next/headers": path.resolve(__dirname, "test/setup/next-headers-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Estos tests pegan contra Postgres real (Neon branch efímero o local)
    // — no son unit tests con mocks (mismo espíritu que Tests.js contra un
    // Catálogo Central de prueba real, ver plan). Se corren secuenciales
    // por default para evitar carreras entre tests que comparten tablas.
    fileParallelism: false,
    // test/e2e/*.spec.ts y test/e2e-demo/*.spec.ts son specs de Playwright (navegador real, otro
    // test runner) — matchean el include por defecto de Vitest
    // (**/*.spec.ts) pero no corren acá; ver playwright.config.ts / `npm
    // run test:e2e` y playwright.demo.config.ts.
    exclude: [...configDefaults.exclude, "test/e2e/**", "test/e2e-demo/**"],
    // Cobertura (2026-09-28, hallazgo post-Task #41): el catch de P2002 de `registrar-pago-consignante.ts` nunca se ejecutaba con el
    // test de idempotencia "doble clic" original (secuencial, dos `await` uno detrás del otro) — un reporte de cobertura lo habría
    // marcado sin que hiciera falta pensar el escenario de carrera a mano. `npm run test:coverage` (INFORMATIVO por ahora, no forma
    // parte del gate de 7 comandos — mismo criterio de rollout gradual que knip en K1: primero visibilidad, recién después umbral
    // obligatorio, si se decide). Acotado a los casos de uso y la persistencia (server/), que es donde vive la lógica de negocio con
    // ramas de error/reintento — UI y core puro tienen su propia cobertura implícita vía los tests que ya los ejercitan.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/server/actions/**/casos-de-uso/**", "src/server/persistencia/**"],
      exclude: [...configDefaults.exclude, "src/server/actions/**/casos-de-uso/**/*.d.ts"],
    },
  },
});
