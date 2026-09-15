import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: la URL de conexión ya no vive en schema.prisma — Migrate/CLI la
// toma de acá. DIRECT_URL es la conexión directa a Neon (sin pooler), que
// es la que necesitan las migraciones; DATABASE_URL (con pgbouncer) la usa
// el runtime de la app vía el driver adapter (ver src/lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
