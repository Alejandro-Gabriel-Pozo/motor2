-- Reversa de 20261014150000_rls_sucursal_b5_stock_y_dinero: DROP POLICY IF EXISTS de las 24 políticas (idempotente). No toca datos. Bajar ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014150000_rls_sucursal_b5_stock_y_dinero`.
-- Al bajarla, las tablas del grupo quedan solo con la RLS por empresa: la app ve las filas de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ConteoFisico";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ConteoFisico";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ConteoFisico";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ConteoFisico";
DROP POLICY IF EXISTS alcance_sucursal_select ON "MovimientoStock";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "MovimientoStock";
DROP POLICY IF EXISTS alcance_sucursal_update ON "MovimientoStock";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "MovimientoStock";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Operacion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Operacion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Operacion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Operacion";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PagoConsignante";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PagoConsignante";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PagoConsignante";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PagoConsignante";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Seccion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Seccion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Seccion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Seccion";
DROP POLICY IF EXISTS alcance_sucursal_select ON "TraspasoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "TraspasoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "TraspasoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "TraspasoSucursal";
