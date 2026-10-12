-- Reversa de 20261016104000_proveedor_condicion_iva_y_puntos_de_venta (Paquete 3, M3e). DESTRUCTIVA si ya hay datos: se pierden la condición frente al IVA de cada proveedor y todos sus puntos de venta. Antes de bajar, guardar
--   SELECT id, "condicionIva" FROM "Proveedor" WHERE "condicionIva" IS NOT NULL;   y   SELECT * FROM "PuntoDeVentaDeProveedor";
-- Es la ÚLTIMA de M3 que se subió, así que es la PRIMERA que se baja (antes de M3d, M3c, la recepción, M3b y M3a). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después
-- `npx prisma migrate resolve --rolled-back 20261016104000_proveedor_condicion_iva_y_puntos_de_venta`. Idempotente (IF EXISTS).

DROP TABLE IF EXISTS "PuntoDeVentaDeProveedor";
ALTER TABLE IF EXISTS "Proveedor" DROP CONSTRAINT IF EXISTS "Proveedor_condicionIva_check";
ALTER TABLE IF EXISTS "Proveedor" DROP COLUMN IF EXISTS "condicionIva";
