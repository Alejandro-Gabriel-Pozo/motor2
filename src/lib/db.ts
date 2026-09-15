import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Prisma 7: la conexión ya no se resuelve desde `datasource.url` en
// schema.prisma — hace falta un driver adapter explícito en el cliente.
// PrismaNeon habla el protocolo HTTP/WebSocket de Neon (mejor fit que TCP
// plano para funciones serverless de Vercel — sin el overhead de abrir una
// conexión TCP nueva por invocación).
function crearPrismaClient() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Singleton — patrón estándar para Next.js en serverless: evita crear un
// adapter/cliente nuevo por cada hot-reload en desarrollo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? crearPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
