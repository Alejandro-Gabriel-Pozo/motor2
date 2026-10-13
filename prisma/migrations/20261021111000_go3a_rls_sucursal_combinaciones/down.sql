-- Reversa de 20261021111000_go3a_rls_sucursal_combinaciones: DROP POLICY IF EXISTS de las 8 políticas de CombinacionEnLinea y PrecioLocalDeCombinacion (idempotente). No toca datos. Bajar ANTES que GO-3a (las tablas) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261021111000_go3a_rls_sucursal_combinaciones`.
-- Al bajarla, las dos tablas quedan solo con la RLS por empresa: la app ve los precios locales y las fotos de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PrecioLocalDeCombinacion";
