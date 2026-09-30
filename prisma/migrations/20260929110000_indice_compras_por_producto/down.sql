-- Reversa de la migración indice_compras_por_producto. Aplicar como el dueño de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 -f down.sql
-- (Prisma no ejecuta este archivo; `_prisma_migrations` hay que ajustarla a mano con `prisma migrate resolve --rolled-back`.)
DROP INDEX IF EXISTS "MovimientoStock_productoId_compra_idx";
