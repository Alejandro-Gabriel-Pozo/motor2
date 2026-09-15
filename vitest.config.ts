import path from "node:path";
import { defineConfig } from "vitest/config";
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
  },
});
