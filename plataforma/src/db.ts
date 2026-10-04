import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { entornoDePlataforma } from "./entorno";

/**
 * La única conexión de la consola: `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`, privilegio mínimo). Sin respaldo en `DATABASE_URL`: ver `entorno.ts`.
 * Se crea al primer uso, no al importar, y se guarda en `globalThis` para sobrevivir a la recarga en caliente de desarrollo.
 */
const global = globalThis as unknown as { prismaPlataforma?: PrismaClient };

export function dbPlataforma(): PrismaClient {
  if (global.prismaPlataforma) return global.prismaPlataforma;
  const connectionString = entornoDePlataforma().PLATAFORMA_DATABASE_URL;
  const adapter = /\bneon\.tech\b/.test(connectionString) ? new PrismaNeon({ connectionString }) : new PrismaPg({ connectionString });
  global.prismaPlataforma = new PrismaClient({ adapter });
  return global.prismaPlataforma;
}
