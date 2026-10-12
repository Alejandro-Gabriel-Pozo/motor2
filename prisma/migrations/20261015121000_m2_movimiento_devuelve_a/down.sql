-- Reversa de 20261015121000_m2_movimiento_devuelve_a. DESTRUCTIVA si ya hay datos: se pierde el origen de las devoluciones a proveedor, que NO se puede reconstruir.
-- Antes de bajar, contar: `SELECT count(*) FROM "MovimientoStock" WHERE "devuelveAMovimientoId" IS NOT NULL`.
-- Recomendación: bajar M2 solo ANTES de desplegar la Etapa C (con la columna en NULL no se pierde nada). Orden de la reversa del Paquete 2: M2-4, M2-3, esta (M2-2) y M2-1 al final.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261015121000_m2_movimiento_devuelve_a`. Idempotente (IF EXISTS).

ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_devuelve_solo_devolucion_proveedor_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_empresaId_devuelveAMovimientoId_fkey";
DROP INDEX IF EXISTS "MovimientoStock_devuelveAMovimientoId_idx";
ALTER TABLE "MovimientoStock" DROP COLUMN IF EXISTS "devuelveAMovimientoId";
