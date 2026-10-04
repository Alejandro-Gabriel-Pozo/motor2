import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Cliente de los scripts de plataforma (`politica-empresa`): usa `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`, ver
 * scripts/operaciones/crear-rol-motor2-plataforma.sql) y, si no está definida, `DATABASE_URL` como hasta ahora. Es el único camino con permiso para
 * escribir `Empresa` una vez aplicada la separación de roles. La URL va en un archivo local (`DOTENV_CONFIG_PATH=.env.plataforma.<despliegue>`),
 * nunca en las variables de Vercel.
 */
const connectionString = process.env.PLATAFORMA_DATABASE_URL || process.env.DATABASE_URL || "";
const adapter = /\bneon\.tech\b/.test(connectionString) ? new PrismaNeon({ connectionString }) : new PrismaPg({ connectionString });

export const prismaPlataforma = new PrismaClient({ adapter });
