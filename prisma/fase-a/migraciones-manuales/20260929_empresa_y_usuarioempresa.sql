-- Fase A — introduce Empresa/UsuarioEmpresa y Sucursal.empresaId.
-- Escrita a mano (patrón de 3 pasos: columna nullable -> backfill -> NOT NULL)
-- para poder aplicarse sobre una base con Sucursal ya pobladas sin romper
-- filas existentes. Pensada para el Neon dedicado de Fase A; se adapta a
-- prisma/migrations/ (contra datos reales) recién cuando el dueño decida
-- activarlo.

BEGIN;

-- 1. Catálogo de empresa.
CREATE TYPE "EstadoEmpresa" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DELETING');

CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "zonaHoraria" TEXT NOT NULL,
    "moneda" TEXT NOT NULL,
    "estado" "EstadoEmpresa" NOT NULL DEFAULT 'PROVISIONING',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Empresa_nombre_key" ON "Empresa"("nombre");
CREATE UNIQUE INDEX "Empresa_slug_key" ON "Empresa"("slug");

CREATE TABLE "UsuarioEmpresa" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "esGerente" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsuarioEmpresa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsuarioEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id"),
    CONSTRAINT "UsuarioEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
);
CREATE UNIQUE INDEX "UsuarioEmpresa_usuarioId_empresaId_key" ON "UsuarioEmpresa"("usuarioId", "empresaId");

-- 2. Columna nullable primero — no rompe ninguna Sucursal existente.
ALTER TABLE "Sucursal" ADD COLUMN "empresaId" TEXT;

-- 3. Empresa por defecto (placeholder deliberado; el nombre/slug reales los
--    define el dueño en la migración de Fase B contra datos de producción)
--    + backfill de toda Sucursal existente a esa empresa.
INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda", "estado")
VALUES ('empresa_default_fase_a', 'Empresa por defecto', 'empresa-por-defecto', 'America/Argentina/Buenos_Aires', 'ARS', 'ACTIVE');

UPDATE "Sucursal" SET "empresaId" = 'empresa_default_fase_a' WHERE "empresaId" IS NULL;

-- 4. NOT NULL + FK + índices compuestos, recién con todas las filas backfilleadas.
ALTER TABLE "Sucursal" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");

DROP INDEX "Sucursal_nombre_key";
CREATE UNIQUE INDEX "Sucursal_empresaId_id_key" ON "Sucursal"("empresaId", "id");
CREATE UNIQUE INDEX "Sucursal_empresaId_nombre_key" ON "Sucursal"("empresaId", "nombre");

COMMIT;
