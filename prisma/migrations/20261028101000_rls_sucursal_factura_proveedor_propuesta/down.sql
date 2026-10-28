-- Reversa de 20261028101000_rls_sucursal_factura_proveedor_propuesta: DROP POLICY IF EXISTS de las 4 políticas de cada tabla (idempotente). No toca datos. Bajar ANTES que 20261028100000 (las tablas) y ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261028101000_rls_sucursal_factura_proveedor_propuesta`.
-- Al bajarla, las dos tablas quedan solo con la RLS por empresa: la app ve las propuestas de TODAS las sucursales de su empresa (regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "FacturaProveedorPropuesta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "FacturaProveedorPropuesta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "FacturaProveedorPropuesta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "FacturaProveedorPropuesta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "FacturaProveedorPropuestaRenglon";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "FacturaProveedorPropuestaRenglon";
DROP POLICY IF EXISTS alcance_sucursal_update ON "FacturaProveedorPropuestaRenglon";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "FacturaProveedorPropuestaRenglon";
