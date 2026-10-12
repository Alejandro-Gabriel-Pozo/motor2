-- Reversa de 20261014140000_rls_sucursal_b4_punto_de_venta: DROP POLICY IF EXISTS de las 24 políticas (idempotente). No toca datos. Bajar ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014140000_rls_sucursal_b4_punto_de_venta`.
-- Al bajarla, las tablas del grupo quedan solo con la RLS por empresa: la app ve las filas de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "AgregadoDeCuenta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "AgregadoDeCuenta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "AgregadoDeCuenta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "AgregadoDeCuenta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Cuenta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Cuenta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Cuenta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Cuenta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "CuentaItem";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CuentaItem";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CuentaItem";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CuentaItem";
DROP POLICY IF EXISTS alcance_sucursal_select ON "EjemplarTicket";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "EjemplarTicket";
DROP POLICY IF EXISTS alcance_sucursal_update ON "EjemplarTicket";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "EjemplarTicket";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Mesa";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Mesa";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Mesa";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Mesa";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PromoCuenta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PromoCuenta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PromoCuenta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PromoCuenta";
