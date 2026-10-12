-- Reversa de 20261016102000_rls_sucursal_factura_proveedor_sucursal: DROP POLICY IF EXISTS de las 4 políticas de FacturaProveedorSucursal (idempotente). No toca datos. Bajar ANTES que M3b (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016102000_rls_sucursal_factura_proveedor_sucursal`.
-- Al bajarla, FacturaProveedorSucursal queda solo con la RLS por empresa: la app ve las partes de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "FacturaProveedorSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "FacturaProveedorSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "FacturaProveedorSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "FacturaProveedorSucursal";
