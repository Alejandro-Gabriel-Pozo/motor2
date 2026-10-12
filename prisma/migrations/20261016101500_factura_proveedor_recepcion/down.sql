-- Reversa de 20261016101500_factura_proveedor_recepcion (Paquete 3, M3b segunda parte). DESTRUCTIVA si ya hay recepciones: se pierden el estado de recepción, cuándo y quién recibió cada parte (el stock que ya entró y las
-- `Operacion` NO se tocan). Antes de bajar, guardar: SELECT id, "estadoRecepcion", "recibidaEn", "recibidaPorId" FROM "FacturaProveedorSucursal" WHERE "estadoRecepcion" = 'RECIBIDA';
-- Orden de la reversa de M3: M3e, M3d, M3c, esta, M3b, M3a. A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016101500_factura_proveedor_recepcion`.
-- Idempotente (IF EXISTS).

DROP TRIGGER IF EXISTS "FacturaProveedorSucursal_recepcion_transicion_chk" ON "FacturaProveedorSucursal";
DROP FUNCTION IF EXISTS "FacturaProveedorSucursal_recepcion_solo_pendiente_a_recibida"();

ALTER TABLE IF EXISTS "FacturaProveedorSucursal" DROP CONSTRAINT IF EXISTS "FacturaProveedorSucursal_recibida_por_chk";
ALTER TABLE IF EXISTS "FacturaProveedorSucursal" DROP CONSTRAINT IF EXISTS "FacturaProveedorSucursal_recepcion_coherente_chk";
ALTER TABLE IF EXISTS "FacturaProveedorSucursal" DROP CONSTRAINT IF EXISTS "FacturaProveedorSucursal_estado_recepcion_chk";
ALTER TABLE IF EXISTS "FacturaProveedorSucursal" DROP CONSTRAINT IF EXISTS "FacturaProveedorSucursal_recibidaPorId_fkey";
ALTER TABLE IF EXISTS "FacturaProveedorSucursal"
  DROP COLUMN IF EXISTS "recibidaPorId",
  DROP COLUMN IF EXISTS "recibidaEn",
  DROP COLUMN IF EXISTS "estadoRecepcion";
