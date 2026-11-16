-- Reversa de 20261117130100_rls_sucursal_orden_de_compra (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117130100_rls_sucursal_orden_de_compra`).
-- Solo borra las 4 políticas de alcance de cada tabla de la orden de compra y del vínculo: la app vuelve a ver todo lo de su empresa en esas tablas (regresión de seguridad, no de datos). Se baja ANTES que 20261117130000.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "LineaDeOrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "LineaDeOrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_update ON "LineaDeOrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "LineaDeOrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_select ON "OrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "OrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_update ON "OrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "OrdenDeCompra";
DROP POLICY IF EXISTS alcance_sucursal_select ON "SaldoDeLineaDeOrden";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "SaldoDeLineaDeOrden";
DROP POLICY IF EXISTS alcance_sucursal_update ON "SaldoDeLineaDeOrden";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "SaldoDeLineaDeOrden";
DROP POLICY IF EXISTS alcance_sucursal_select ON "VinculoDeRenglonConOrden";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "VinculoDeRenglonConOrden";
DROP POLICY IF EXISTS alcance_sucursal_update ON "VinculoDeRenglonConOrden";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "VinculoDeRenglonConOrden";
