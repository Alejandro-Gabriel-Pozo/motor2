-- Reversa de 20261019102000_rls_sucursal_centros_de_costos: DROP POLICY IF EXISTS de las 12 políticas de PlanDeCostosSucursal, DistribucionCostoVersion y DistribucionCostoLinea (idempotente). No toca datos. Bajar ANTES que M7.2 y M7.1 (las tablas) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261019102000_rls_sucursal_centros_de_costos`.
-- Al bajarla, las tres tablas quedan solo con la RLS por empresa: la app ve la aplicabilidad y las distribuciones de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "DistribucionCostoLinea";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "DistribucionCostoLinea";
DROP POLICY IF EXISTS alcance_sucursal_update ON "DistribucionCostoLinea";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "DistribucionCostoLinea";
DROP POLICY IF EXISTS alcance_sucursal_select ON "DistribucionCostoVersion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "DistribucionCostoVersion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "DistribucionCostoVersion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "DistribucionCostoVersion";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PlanDeCostosSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PlanDeCostosSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PlanDeCostosSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PlanDeCostosSucursal";
