-- Reversa de 20261016113000_rls_sucursal_imputacion_de_gasto: DROP POLICY IF EXISTS de las 4 políticas de ImputacionDeGasto (idempotente). No toca datos. Bajar ANTES que M4.3 (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016113000_rls_sucursal_imputacion_de_gasto`.
-- Al bajarla, ImputacionDeGasto queda solo con la RLS por empresa: la app ve las imputaciones de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ImputacionDeGasto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ImputacionDeGasto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ImputacionDeGasto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ImputacionDeGasto";
