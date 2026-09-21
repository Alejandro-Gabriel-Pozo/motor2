-- Borra el índice único de factura de compra que no filtraba por anulación (lo reemplaza "Operacion_factura_unica_vigente_key",
-- migración 20260921230000). Va en su propio archivo: DROP INDEX CONCURRENTLY tampoco puede correr dentro de una transacción, y Prisma
-- Migrate envuelve en una transacción cualquier archivo con más de una sentencia.
DROP INDEX CONCURRENTLY IF EXISTS "Operacion_factura_unica_key";
