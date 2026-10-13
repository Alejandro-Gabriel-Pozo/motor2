-- Reversa de 20261020121000_go1c_rls_sucursal_opciones_por_sucursal: DROP POLICY IF EXISTS de las 8 políticas de OpcionApagadaEnSucursal y PrecioLocalDeOpcion (idempotente). No toca datos. Bajar ANTES que GO-1c (las tablas) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261020121000_go1c_rls_sucursal_opciones_por_sucursal`.
-- Al bajarla, las dos tablas quedan solo con la RLS por empresa: la app ve lo apagado y los precios de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "OpcionApagadaEnSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "OpcionApagadaEnSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "OpcionApagadaEnSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "OpcionApagadaEnSucursal";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PrecioLocalDeOpcion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PrecioLocalDeOpcion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PrecioLocalDeOpcion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PrecioLocalDeOpcion";
