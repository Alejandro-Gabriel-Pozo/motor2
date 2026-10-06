import { defineConfig } from "prisma/config";

// Config dedicado a la experimentación de schema de Fase A — deliberadamente
// NO reusa prisma.config.ts (ese apunta, vía DIRECT_URL, al Postgres local
// motor2_dev). Este solo lee FASE_A_DIRECT_URL, cargado a mano desde
// .env.multitenancy (nunca desde .env), para que sea imposible que un
// comando de esta carpeta toque la base local por accidente de nombre de
// variable compartido.
export default defineConfig({
  schema: "schema.prisma",
  datasource: {
    url: process.env.FASE_A_DIRECT_URL ?? "",
  },
});
