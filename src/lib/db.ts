import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7: la conexión ya no se resuelve desde `datasource.url` en
 * schema.prisma — hace falta un driver adapter explícito en el cliente.
 *
 * BUG ENCONTRADO (sesión "Movimientos", al intentar correr `npm test`
 * contra un Postgres real por primera vez — ver README, "Migración
 * inicial de Prisma no corrida todavía contra una base real"): PrismaNeon
 * habla el protocolo HTTP/WebSocket propio de la infraestructura de Neon
 * (mejor fit que TCP plano para funciones serverless de Vercel), pero eso
 * significa que NO puede hablar con el Postgres liso de `docker compose up
 * -d` (README, "Local") — revienta con "Received network error or non-101
 * status code" apenas se ejecuta la primera query. El README prometía las
 * dos opciones (Neon o local) como intercambiables; en runtime no lo eran.
 *
 * FIX: detectar por el propio `DATABASE_URL` si el host es de Neon
 * (`neon.tech`) y usar PrismaNeon SOLO en ese caso — cualquier otro host
 * (local, `docker compose`, otro proveedor de Postgres) usa PrismaPg
 * (driver `pg` estándar, protocolo TCP normal, funciona contra cualquier
 * Postgres real). No es una detección por NODE_ENV/test a propósito: así
 * un `DATABASE_URL` de Neon sigue usando el adapter optimizado para
 * Vercel incluso corriendo tests o localmente contra un branch de Neon.
 */
function crearPrismaClient() {
  const connectionString = process.env.DATABASE_URL ?? "";
  const esNeon = /\bneon\.tech\b/.test(connectionString);
  const adapter = esNeon ? new PrismaNeon({ connectionString }) : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Singleton — patrón estándar para Next.js en serverless: evita crear un
// adapter/cliente nuevo por cada hot-reload en desarrollo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? crearPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
