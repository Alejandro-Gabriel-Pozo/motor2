-- Reversa de 20261021101000_go3d_rls_sucursal_menu_del_dia: DROP POLICY IF EXISTS de las 4 políticas de EntradaDelDiaDeCupo (idempotente). No toca datos. Bajar ANTES que GO-3d (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261021101000_go3d_rls_sucursal_menu_del_dia`.
-- Al bajarla, la tabla queda solo con la RLS por empresa: la app ve los platos del día de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "EntradaDelDiaDeCupo";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "EntradaDelDiaDeCupo";
DROP POLICY IF EXISTS alcance_sucursal_update ON "EntradaDelDiaDeCupo";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "EntradaDelDiaDeCupo";
