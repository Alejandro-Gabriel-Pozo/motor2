import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Cliente del DUEÑO de las tablas (`DIRECT_URL`, el mismo rol que migra), para lo que el rol de ejecución no puede hacer a propósito
 * (TRUNCATE, DDL, saltar el RLS). `prisma` (el de `src/lib/db`) es el runtime real: `DATABASE_URL`, rol `motor2_app` (ADR-007, A0). No se conecta
 * hasta la primera consulta.
 */
export const prismaAdmin = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? "" }) });
