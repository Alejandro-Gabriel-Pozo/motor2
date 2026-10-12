-- Reversa de 20261014130000_rls_sucursal_b3_carta: DROP POLICY IF EXISTS de las 24 políticas (idempotente). No toca datos. Bajar ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014130000_rls_sucursal_b3_carta`.
-- Al bajarla, las tablas del grupo quedan solo con la RLS por empresa: la app ve las filas de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ContenidoCartaProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ContenidoCartaProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ContenidoCartaProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ContenidoCartaProducto";
DROP POLICY IF EXISTS alcance_sucursal_select ON "GeneroCarta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "GeneroCarta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "GeneroCarta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "GeneroCarta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "ItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "OpcionItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "OpcionItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "OpcionItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "OpcionItemAgrupadoCarta";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PromoCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PromoCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PromoCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PromoCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_select ON "TemaCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "TemaCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "TemaCartaSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "TemaCartaSucursal";
