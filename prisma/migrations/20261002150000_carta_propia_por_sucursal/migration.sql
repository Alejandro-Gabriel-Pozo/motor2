-- Carta PROPIA por sucursal (decisión del dueño, 2026-10-02; ADR-009 C3/C4, familia «opt-in»; esquema autorizado expresamente). Hasta ahora la
-- estructura de la carta (contenido de cada producto, géneros, ítems agrupados y sus opciones) era UNA sola por empresa y todas las sucursales la
-- compartían. Ahora cada sucursal tiene la suya: una sucursal sin carta propia no muestra nada hasta que la arma o la copia de otra. Las SECCIONES
-- de carta (`SeccionCarta`) siguen siendo de la empresa; las promos y los cupos no se tocan. Reversa: down.sql.
--
-- 1) `sucursalId` en ContenidoCartaProducto, GeneroCarta, ItemAgrupadoCarta y OpcionItemAgrupadoCarta (FK compuesta (empresaId, sucursalId), como el resto).
-- 2) Los únicos que eran de la empresa pasan a ser de la sucursal: (sucursalId, productoId) para el contenido y las opciones, (sucursalId, nombre) para
--    géneros e ítems agrupados.
--
-- DATOS EXISTENTES: la carta que ya hay no se duplica a todas las sucursales; cada empresa la deja en UNA sola sucursal, la que ya la mostraba al
-- público: la que tiene una `SucursalPublica` PUBLICADA (si hay varias, la sucursal más antigua por `creadoEn`, desempate por id); si ninguna está
-- publicada, la primera sucursal activa (mismo orden); y si no hubiera ninguna activa, la primera sucursal sin más. Las demás empiezan sin carta
-- (opt-in: la arman o la copian). Una empresa SIN sucursales no tiene dónde mostrar su carta: sus filas de estructura se borran (no son alcanzables
-- desde ninguna pantalla) para no romper el NOT NULL.
-- Se escribe `empresaId`/`sucursalId` explícitos: la migración corre como dueño de las tablas (sin RLS) y el default `app_empresa_actual()` no aplica.

-- Destino de la carta existente, una fila por empresa.
CREATE TEMP TABLE "_carta_destino" AS
SELECT DISTINCT ON (s."empresaId") s."empresaId", s."id" AS "sucursalId"
FROM "Sucursal" s
LEFT JOIN "SucursalPublica" sp ON sp."empresaId" = s."empresaId" AND sp."sucursalId" = s."id" AND sp."publicada" = true
ORDER BY s."empresaId", (sp."id" IS NOT NULL) DESC, s."activo" DESC, s."creadoEn" ASC, s."id" ASC;

-- AlterTable
ALTER TABLE "ContenidoCartaProducto" ADD COLUMN "sucursalId" TEXT;
ALTER TABLE "GeneroCarta" ADD COLUMN "sucursalId" TEXT;
ALTER TABLE "ItemAgrupadoCarta" ADD COLUMN "sucursalId" TEXT;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD COLUMN "sucursalId" TEXT;

-- Backfill: toda la carta existente de cada empresa a su sucursal destino.
UPDATE "ContenidoCartaProducto" t SET "sucursalId" = d."sucursalId" FROM "_carta_destino" d WHERE t."empresaId" = d."empresaId";
UPDATE "GeneroCarta" t SET "sucursalId" = d."sucursalId" FROM "_carta_destino" d WHERE t."empresaId" = d."empresaId";
UPDATE "ItemAgrupadoCarta" t SET "sucursalId" = d."sucursalId" FROM "_carta_destino" d WHERE t."empresaId" = d."empresaId";
UPDATE "OpcionItemAgrupadoCarta" t SET "sucursalId" = d."sucursalId" FROM "_carta_destino" d WHERE t."empresaId" = d."empresaId";

-- Empresas sin sucursales: quien referencia se borra antes (opciones -> ítems -> contenidos -> géneros).
DELETE FROM "OpcionItemAgrupadoCarta" WHERE "sucursalId" IS NULL;
DELETE FROM "ItemAgrupadoCarta" WHERE "sucursalId" IS NULL;
DELETE FROM "ContenidoCartaProducto" WHERE "sucursalId" IS NULL;
DELETE FROM "GeneroCarta" WHERE "sucursalId" IS NULL;

DROP TABLE "_carta_destino";

-- AlterTable
ALTER TABLE "ContenidoCartaProducto" ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "GeneroCarta" ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "ItemAgrupadoCarta" ALTER COLUMN "sucursalId" SET NOT NULL;
ALTER TABLE "OpcionItemAgrupadoCarta" ALTER COLUMN "sucursalId" SET NOT NULL;

-- DropIndex
DROP INDEX "ContenidoCartaProducto_empresaId_productoId_key";
DROP INDEX "GeneroCarta_empresaId_nombre_key";
DROP INDEX "ItemAgrupadoCarta_empresaId_nombre_key";
DROP INDEX "OpcionItemAgrupadoCarta_empresaId_productoId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ContenidoCartaProducto_sucursalId_productoId_key" ON "ContenidoCartaProducto"("sucursalId", "productoId");
CREATE UNIQUE INDEX "GeneroCarta_sucursalId_nombre_key" ON "GeneroCarta"("sucursalId", "nombre");
CREATE UNIQUE INDEX "ItemAgrupadoCarta_sucursalId_nombre_key" ON "ItemAgrupadoCarta"("sucursalId", "nombre");
CREATE UNIQUE INDEX "OpcionItemAgrupadoCarta_sucursalId_productoId_key" ON "OpcionItemAgrupadoCarta"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneroCarta" ADD CONSTRAINT "GeneroCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
