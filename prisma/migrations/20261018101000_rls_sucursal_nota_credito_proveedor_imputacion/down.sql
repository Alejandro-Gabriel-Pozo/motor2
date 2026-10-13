-- Reversa de 20261018101000_rls_sucursal_nota_credito_proveedor_imputacion: DROP POLICY IF EXISTS de las 4 políticas de NotaCreditoProveedorImputacion (idempotente). No toca datos. Bajar ANTES que M6.1 (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261018101000_rls_sucursal_nota_credito_proveedor_imputacion`.
-- Al bajarla, NotaCreditoProveedorImputacion queda solo con la RLS por empresa: la app ve las imputaciones de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "NotaCreditoProveedorImputacion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "NotaCreditoProveedorImputacion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "NotaCreditoProveedorImputacion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "NotaCreditoProveedorImputacion";
