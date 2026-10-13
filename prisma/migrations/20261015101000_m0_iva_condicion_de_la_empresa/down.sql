-- Reversa de 20261015101000_m0_iva_condicion_de_la_empresa. Como dueño, a mano: `psql -1 -v ON_ERROR_STOP=1 -f down.sql`.
-- ADVERTENCIA: DESTRUCTIVA apenas alguien haya cargado la condición de una empresa (paso de datos o consola de plataforma): se pierde ese valor. Antes de bajar, si hay datos, guardar:
--   SELECT "id", "slug", "condicionIva" FROM "Empresa" WHERE "condicionIva" IS NOT NULL;
-- Volver primero el código (Instant Rollback) y recién después correr esto.
-- Después: `prisma migrate resolve --rolled-back 20261015101000_m0_iva_condicion_de_la_empresa`.
ALTER TABLE "Empresa" DROP CONSTRAINT IF EXISTS "Empresa_condicionIva_check";
ALTER TABLE "Empresa" DROP COLUMN IF EXISTS "condicionIva";
