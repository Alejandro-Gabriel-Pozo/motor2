import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Cliente con el rol REAL `motor2_plataforma` (`PLATAFORMA_DATABASE_URL`), el que usa la consola en producción: privilegio mínimo tabla por tabla, RLS por nombre de rol y
 * sin BYPASSRLS. Los tests que lo usan corren con `describe.skipIf(!HAY_ROL_DE_PLATAFORMA)`: la base de test local no crea el rol; el job `integracion` de CI sí
 * (`scripts/operaciones/crear-rol-motor2-plataforma.sql`). Complementa a `prismaAdmin` (el dueño), que salta el RLS y los triggers y por eso no prueba los permisos.
 * No se conecta hasta la primera consulta.
 */
export const HAY_ROL_DE_PLATAFORMA = Boolean(process.env.PLATAFORMA_DATABASE_URL);

export const plataformaReal = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PLATAFORMA_DATABASE_URL ?? "" }) });
