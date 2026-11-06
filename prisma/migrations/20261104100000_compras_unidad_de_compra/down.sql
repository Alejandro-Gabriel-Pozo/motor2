-- Reversa de 20261104100000_compras_unidad_de_compra (Compras etapa 2a). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna línea ya tiene unidad de compra o cantidad comprada cargada:
-- esos datos no se borran en silencio. Si hace falta resguardarlos primero:
--   SELECT "id", "empresaId", "unidadCompraId", "cantidadCompra" FROM "MovimientoStock" WHERE "cantidadCompra" IS NOT NULL OR "unidadCompraId" IS NOT NULL;
--   SELECT "id", "empresaId", "unidadCompraId", "cantidadCompra" FROM "FacturaProveedorRenglon" WHERE "cantidadCompra" IS NOT NULL OR "unidadCompraId" IS NOT NULL;
-- Idempotente (IF EXISTS). Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA: con una que terminó bien da P3012):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261104100000_compras_unidad_de_compra' AND rolled_back_at IS NULL;

DO $$
DECLARE
  n bigint := 0;
  m bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'MovimientoStock' AND column_name = 'cantidadCompra') THEN
    EXECUTE 'SELECT count(*) FROM "MovimientoStock" WHERE "cantidadCompra" IS NOT NULL OR "unidadCompraId" IS NOT NULL' INTO n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FacturaProveedorRenglon' AND column_name = 'cantidadCompra') THEN
    EXECUTE 'SELECT count(*) FROM "FacturaProveedorRenglon" WHERE "cantidadCompra" IS NOT NULL OR "unidadCompraId" IS NOT NULL' INTO m;
  END IF;
  IF n > 0 OR m > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261104100000_compras_unidad_de_compra: hay % movimiento(s) y % renglón(es) de factura con unidad de compra cargada. Resguardalos y decidí antes cómo seguir.', n, m;
  END IF;
END
$$;

ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_cantidad_compra_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_unidad_compra_pareo_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_empresaId_unidadCompraId_fkey";
ALTER TABLE "MovimientoStock" DROP COLUMN IF EXISTS "cantidadCompra", DROP COLUMN IF EXISTS "unidadCompraId";

ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_cantidad_compra_chk";
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_unidad_compra_pareo_chk";
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_empresaId_unidadCompraId_fkey";
ALTER TABLE "FacturaProveedorRenglon" DROP COLUMN IF EXISTS "cantidadCompra", DROP COLUMN IF EXISTS "unidadCompraId";
