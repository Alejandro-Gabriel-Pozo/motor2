-- Reversa de 20261002130000_receta_propia_por_sucursal. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261002130000_receta_propia_por_sucursal/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- SE PIERDEN las recetas propias de las sucursales (son dato nuevo de esta fase): cada sucursal vuelve a regirse por la central.

DROP POLICY IF EXISTS aislamiento_empresa ON "RecetaSucursal";
DROP TABLE "RecetaSucursal";

-- Las versiones propias (con ingredientes y pasos, por cascada) y las calibraciones que colgaban de ellas.
DELETE FROM "RecetaVersion" WHERE "sucursalId" IS NOT NULL;

ALTER TABLE "RecetaVersion" DROP CONSTRAINT "RecetaVersion_empresaId_sucursalId_fkey";
DROP INDEX "RecetaVersion_productoId_sucursalId_idx";
DROP INDEX "RecetaVersion_productoId_sucursalId_version_propia_key";
DROP INDEX "RecetaVersion_productoId_version_central_key";
ALTER TABLE "RecetaVersion" DROP COLUMN "basadaEnVersionId", DROP COLUMN "sucursalId";
CREATE UNIQUE INDEX "RecetaVersion_productoId_version_key" ON "RecetaVersion"("productoId", "version");
