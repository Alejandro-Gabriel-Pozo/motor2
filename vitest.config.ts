import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Estos tests pegan contra Postgres real (Neon branch efímero o local)
    // — no son unit tests con mocks (mismo espíritu que Tests.js contra un
    // Catálogo Central de prueba real, ver plan). Se corren secuenciales
    // por default para evitar carreras entre tests que comparten tablas.
    fileParallelism: false,
  },
});
