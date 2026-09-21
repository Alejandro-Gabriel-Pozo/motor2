-- Índice único parcial de factura de compra que IGNORA las compras anuladas (K1c, anular una compra).
--
-- Reemplaza a "Operacion_factura_unica_key" (migración 20260920220000), que no filtraba por anulación: al anular una compra su
-- N.º de factura seguía ocupado y «anular y recargar» con el mismo número chocaba contra el propio índice. Con el predicado
-- "anuladaEn" IS NULL, una compra anulada deja libre su factura y solo cuentan las vigentes.
--
-- No se reescribe la migración anterior: ya está aplicada en las bases locales y cambiarla rompería su checksum. Este archivo
-- crea el índice nuevo y el siguiente (20260921230100) borra el viejo, uno por archivo.
--
-- Mismos criterios que el índice viejo: sin NULLS NOT DISTINCT (una compra sin proveedor no choca con otra, paridad con el chequeo de
-- aplicación de registrarMovimiento) y CONCURRENTLY, que no toma un lock exclusivo sobre Operacion mientras se construye y por eso
-- debe ser la ÚNICA sentencia del archivo (Postgres no permite CREATE INDEX CONCURRENTLY dentro de un bloque de transacción, y Prisma
-- Migrate envuelve en una transacción cualquier archivo con más de una sentencia).
--
-- En Neon, donde la migración 20260920220000 todavía no se aplicó, `migrate deploy` corre las tres en fila (crear el viejo, crear
-- este, borrar el viejo): queda solo este índice.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Operacion_factura_unica_vigente_key"
  ON "Operacion" ("sucursalId", "proveedorId", "nroFactura")
  WHERE "nroFactura" IS NOT NULL AND proceso = 'COMPRA' AND "anuladaEn" IS NULL;
