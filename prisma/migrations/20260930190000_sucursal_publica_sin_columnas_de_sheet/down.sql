-- Reversa de sucursal_publica_sin_columnas_de_sheet. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260930190000_sucursal_publica_sin_columnas_de_sheet/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (`DELETE FROM "_prisma_migrations" WHERE migration_name =
-- '20260930190000_sucursal_publica_sin_columnas_de_sheet'`): `prisma migrate resolve --rolled-back` NO sirve acá, solo acepta
-- migraciones en estado fallido y esta figura como aplicada. Sin borrar la fila, un `migrate deploy` posterior no la reaplica.
-- Recrea las 4 columnas con su tipo y default originales y el índice UNIQUE sobre "dominio". NO recupera los valores que tenían
-- antes del DROP: vuelven como NULL / false / 'Menu'. Si hace falta el dato, restaurar desde un backup tomado antes de la migración.

ALTER TABLE "SucursalPublica" ADD COLUMN "dominio" TEXT,
ADD COLUMN "menuDesdeMotor2" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sheetId" TEXT,
ADD COLUMN "sheetMenuNombre" TEXT NOT NULL DEFAULT 'Menu';

CREATE UNIQUE INDEX "SucursalPublica_dominio_key" ON "SucursalPublica"("dominio");
