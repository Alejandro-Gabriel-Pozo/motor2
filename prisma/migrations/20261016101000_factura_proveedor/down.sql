-- Reversa de 20261016101000_factura_proveedor (Paquete 3, M3b). DESTRUCTIVA si ya hay facturas: se pierden las cabeceras, los renglones y las partes (el Kardex y las `Operacion` NO se tocan; solo pierde la
-- referencia al renglón de factura, `MovimientoStock.facturaProveedorRenglonId`, que se borra).
-- Antes de bajar, contar: `SELECT count(*) FROM "FacturaProveedor"`, `FROM "FacturaProveedorRenglon"`, `FROM "FacturaProveedorSucursal"` y `SELECT count(*) FROM "MovimientoStock" WHERE "facturaProveedorRenglonId" IS NOT NULL`,
-- y guardar una copia de las tablas (`pg_dump -t '"FacturaProveedor*"'`) si alguno da más de 0.
-- Recomendación: bajar M3 solo ANTES de desplegar la Etapa C (con las tablas vacías no se pierde nada).
-- Bajar ANTES M3d (las columnas de IVA y los tributos cuelgan de estas tablas) y M3c (sus políticas viven sobre `FacturaProveedorSucursal`). Orden de la reversa de M3: M3d, M3c, esta (M3b), M3a. La reversa de B1
-- (funciones de alcance) va DESPUÉS de M3c.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016101000_factura_proveedor`. Idempotente (IF EXISTS).

ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_renglon_solo_compra_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_empresaId_facturaProveedorRenglonId_fkey";
DROP INDEX IF EXISTS "MovimientoStock_facturaProveedorRenglonId_idx";
ALTER TABLE "MovimientoStock" DROP COLUMN IF EXISTS "facturaProveedorRenglonId";

DROP TABLE IF EXISTS "FacturaProveedorSucursal";
DROP TABLE IF EXISTS "FacturaProveedorRenglon";
DROP TABLE IF EXISTS "FacturaProveedor";
