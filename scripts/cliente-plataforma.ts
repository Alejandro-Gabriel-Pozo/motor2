import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Cliente de los scripts de plataforma (`politica-empresa`, `modulos-empresa`, `plataforma/crear-primer-admin`): usa `PLATAFORMA_DATABASE_URL` (rol
 * `motor2_plataforma`, ver scripts/operaciones/crear-rol-motor2-plataforma.sql) y, si no está definida, `DATABASE_URL` como hasta ahora. Es el único
 * lugar bajo `scripts/` que crea un cliente de Prisma o un adaptador. La URL va en un archivo local (`DOTENV_CONFIG_PATH=.env.plataforma.<despliegue>`),
 * nunca en las variables de Vercel.
 */
export function clienteDePlataforma(connectionString: string): PrismaClient {
  const opciones = { connectionString, max: 2, connectionTimeoutMillis: 10_000 };
  const adapter = /\bneon\.tech\b/.test(connectionString) ? new PrismaNeon(opciones) : new PrismaPg(opciones);
  return new PrismaClient({ adapter });
}

export const prismaPlataforma = clienteDePlataforma(process.env.PLATAFORMA_DATABASE_URL || process.env.DATABASE_URL || "");
