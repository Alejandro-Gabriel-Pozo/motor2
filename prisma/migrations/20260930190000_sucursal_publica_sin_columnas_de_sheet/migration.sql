-- Limpieza de columnas muertas de "SucursalPublica": "dominio", "menuDesdeMotor2", "sheetId" y "sheetMenuNombre".
-- Eran datos de transición de cuando la carta vivía en una Google Sheet; ninguna carta lee ya la sheet (la carta pública es de
-- motor2, ADR-006) y ningún código las usa desde el paso anterior de esta limpieza. Se va también el único índice que las
-- tocaba, "SucursalPublica_dominio_key" (el UNIQUE global sobre "dominio"). NO se tocan "posX/posY/posW/posH" ni el resto.
-- DESTRUCTIVA: los valores cargados en esas columnas se pierden (en las bases conocidas estaban vacíos o en sus defaults).
-- Reversa: down.sql (recrea las columnas y el índice, pero NO recupera los datos).

-- DropIndex
DROP INDEX "SucursalPublica_dominio_key";

-- AlterTable
ALTER TABLE "SucursalPublica" DROP COLUMN "dominio",
DROP COLUMN "menuDesdeMotor2",
DROP COLUMN "sheetId",
DROP COLUMN "sheetMenuNombre";
