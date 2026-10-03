-- Reversa de 20261002150000_carta_propia_por_sucursal. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261002150000_carta_propia_por_sucursal/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Vuelve a UNA sola carta por empresa. Si dos sucursales de la misma empresa ya tienen carta propia, NO hay forma de fusionarlas sin elegir: se
-- CONSERVA la de la sucursal más antigua (por `creadoEn`, desempate por id) y se BORRA la de las demás. Es el único paso que pierde datos.

CREATE TEMP TABLE "_carta_conserva" AS
SELECT DISTINCT ON (t."empresaId") t."empresaId", t."sucursalId"
FROM (
  SELECT "empresaId", "sucursalId" FROM "ContenidoCartaProducto"
  UNION SELECT "empresaId", "sucursalId" FROM "GeneroCarta"
  UNION SELECT "empresaId", "sucursalId" FROM "ItemAgrupadoCarta"
  UNION SELECT "empresaId", "sucursalId" FROM "OpcionItemAgrupadoCarta"
) t
JOIN "Sucursal" s ON s."empresaId" = t."empresaId" AND s."id" = t."sucursalId"
ORDER BY t."empresaId", s."creadoEn" ASC, s."id" ASC;

DELETE FROM "OpcionItemAgrupadoCarta" o WHERE NOT EXISTS (SELECT 1 FROM "_carta_conserva" c WHERE c."empresaId" = o."empresaId" AND c."sucursalId" = o."sucursalId");
DELETE FROM "ItemAgrupadoCarta" o WHERE NOT EXISTS (SELECT 1 FROM "_carta_conserva" c WHERE c."empresaId" = o."empresaId" AND c."sucursalId" = o."sucursalId");
DELETE FROM "ContenidoCartaProducto" o WHERE NOT EXISTS (SELECT 1 FROM "_carta_conserva" c WHERE c."empresaId" = o."empresaId" AND c."sucursalId" = o."sucursalId");
DELETE FROM "GeneroCarta" o WHERE NOT EXISTS (SELECT 1 FROM "_carta_conserva" c WHERE c."empresaId" = o."empresaId" AND c."sucursalId" = o."sucursalId");

DROP TABLE "_carta_conserva";

ALTER TABLE "OpcionItemAgrupadoCarta" DROP CONSTRAINT "OpcionItemAgrupadoCarta_empresaId_sucursalId_fkey";
ALTER TABLE "ItemAgrupadoCarta" DROP CONSTRAINT "ItemAgrupadoCarta_empresaId_sucursalId_fkey";
ALTER TABLE "GeneroCarta" DROP CONSTRAINT "GeneroCarta_empresaId_sucursalId_fkey";
ALTER TABLE "ContenidoCartaProducto" DROP CONSTRAINT "ContenidoCartaProducto_empresaId_sucursalId_fkey";

DROP INDEX "OpcionItemAgrupadoCarta_sucursalId_productoId_key";
DROP INDEX "ItemAgrupadoCarta_sucursalId_nombre_key";
DROP INDEX "GeneroCarta_sucursalId_nombre_key";
DROP INDEX "ContenidoCartaProducto_sucursalId_productoId_key";

ALTER TABLE "OpcionItemAgrupadoCarta" DROP COLUMN "sucursalId";
ALTER TABLE "ItemAgrupadoCarta" DROP COLUMN "sucursalId";
ALTER TABLE "GeneroCarta" DROP COLUMN "sucursalId";
ALTER TABLE "ContenidoCartaProducto" DROP COLUMN "sucursalId";

CREATE UNIQUE INDEX "ContenidoCartaProducto_empresaId_productoId_key" ON "ContenidoCartaProducto"("empresaId", "productoId");
CREATE UNIQUE INDEX "GeneroCarta_empresaId_nombre_key" ON "GeneroCarta"("empresaId", "nombre");
CREATE UNIQUE INDEX "ItemAgrupadoCarta_empresaId_nombre_key" ON "ItemAgrupadoCarta"("empresaId", "nombre");
CREATE UNIQUE INDEX "OpcionItemAgrupadoCarta_empresaId_productoId_key" ON "OpcionItemAgrupadoCarta"("empresaId", "productoId");
