-- Reversa de 20261014120000_rls_sucursal_b2_configuracion: DROP POLICY IF EXISTS de las 32 políticas (idempotente). No toca datos. Bajar ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014120000_rls_sucursal_b2_configuracion`.
-- Al bajarla, las tablas del grupo quedan solo con la RLS por empresa: la app ve las filas de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "DescuentoProductoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "DescuentoProductoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "DescuentoProductoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "DescuentoProductoSucursal";
DROP POLICY IF EXISTS alcance_sucursal_select ON "DisponibilidadProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "DisponibilidadProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "DisponibilidadProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "DisponibilidadProducto";
DROP POLICY IF EXISTS alcance_sucursal_select ON "FrecuenciaConteoProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "FrecuenciaConteoProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "FrecuenciaConteoProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "FrecuenciaConteoProducto";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PrecioLocalProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PrecioLocalProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PrecioLocalProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PrecioLocalProducto";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RecetaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RecetaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RecetaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RecetaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RendimientoLocalIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RendimientoLocalIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RendimientoLocalIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RendimientoLocalIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_select ON "SeccionHabitualProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "SeccionHabitualProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "SeccionHabitualProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "SeccionHabitualProducto";
DROP POLICY IF EXISTS alcance_sucursal_select ON "StockMinimoProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "StockMinimoProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "StockMinimoProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "StockMinimoProducto";
