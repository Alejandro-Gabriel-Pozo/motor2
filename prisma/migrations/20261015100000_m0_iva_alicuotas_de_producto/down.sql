-- Reversa de 20261015100000_m0_iva_alicuotas_de_producto. Como dueño, a mano: `psql -1 -v ON_ERROR_STOP=1 -f down.sql`.
-- ADVERTENCIA: DESTRUCTIVA apenas alguien haya cargado alícuotas (la ficha de producto de la Etapa C o un paso de datos): se pierden esos valores. En EXPANDIR nadie los escribe, y
-- entonces no se pierde nada. Antes de bajar, si hay datos, guardar:
--   SELECT "id", "empresaId", "alicuotaIvaVenta", "alicuotaIvaCompra" FROM "Producto" WHERE "alicuotaIvaVenta" IS NOT NULL OR "alicuotaIvaCompra" IS NOT NULL;
-- Volver primero el código (Instant Rollback) y recién después correr esto.
-- Después: `prisma migrate resolve --rolled-back 20261015100000_m0_iva_alicuotas_de_producto`.
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_alicuotaIvaVenta_check", DROP CONSTRAINT IF EXISTS "Producto_alicuotaIvaCompra_check";
ALTER TABLE "Producto" DROP COLUMN IF EXISTS "alicuotaIvaVenta", DROP COLUMN IF EXISTS "alicuotaIvaCompra";
