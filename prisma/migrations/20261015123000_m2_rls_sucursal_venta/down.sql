-- Reversa de 20261015123000_m2_rls_sucursal_venta: DROP POLICY IF EXISTS de las 4 políticas de Venta (idempotente). No toca datos. Bajar ANTES que M2-3 (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261015123000_m2_rls_sucursal_venta`.
-- Al bajarla, Venta queda solo con la RLS por empresa: la app ve las cabeceras de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "Venta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Venta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Venta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Venta";
