import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: la URL de conexión ya no vive en schema.prisma — Migrate/CLI la
// toma de acá. DIRECT_URL es la conexión directa a Neon (sin pooler), que
// es la que necesitan las migraciones; DATABASE_URL (con pgbouncer) la usa
// el runtime de la app vía el driver adapter (ver src/lib/db.ts).
//
// Se usa process.env directo (no el helper env() de prisma/config) porque
// ese helper tira si la variable no está resuelta, y este archivo se carga
// también para `prisma generate` — que no necesita conexión a la DB, solo
// el schema. Si DIRECT_URL falta de verdad, quien lo va a notar es
// `migrate`/`db push` al intentar conectarse, que es el momento correcto.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
