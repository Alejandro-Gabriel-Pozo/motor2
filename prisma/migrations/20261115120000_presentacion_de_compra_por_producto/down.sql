-- Reversa de 20261115120000_presentacion_de_compra_por_producto. Saca el índice, los CHECK y las tres columnas nuevas; NO toca ninguna columna ni fila de antes (la cantidad, la unidad y `activa` quedan como estaban).
-- Descarta lo cargado SOLO con el código nuevo: los nombres propios y las marcas de peso variable. Idempotente.
-- Volver primero el código si hiciera falta y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DROP INDEX IF EXISTS "Presentacion_empresaId_productoId_nombre_lower_key";
ALTER TABLE "Presentacion" DROP CONSTRAINT IF EXISTS "Presentacion_nombre_chk";
ALTER TABLE "Presentacion" DROP CONSTRAINT IF EXISTS "Presentacion_factorConversion_chk";
ALTER TABLE "Presentacion" DROP CONSTRAINT IF EXISTS "Presentacion_version_chk";
ALTER TABLE "Presentacion" DROP COLUMN IF EXISTS "nombre";
ALTER TABLE "Presentacion" DROP COLUMN IF EXISTS "pesoVariable";
ALTER TABLE "Presentacion" DROP COLUMN IF EXISTS "version";
