-- Reversa de 20261020131000_go1d_rls_sucursal_opcion_elegida: DROP POLICY IF EXISTS de las 4 políticas de OpcionElegidaEnLinea (idempotente). No toca datos. Bajar ANTES que GO-1d (la tabla) y ANTES que B1 (las funciones: una política en uso impide borrarlas).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261020131000_go1d_rls_sucursal_opcion_elegida`.
-- Al bajarla, la tabla queda solo con la RLS por empresa: la app ve la foto de las líneas de TODAS las sucursales de su empresa (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "OpcionElegidaEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "OpcionElegidaEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_update ON "OpcionElegidaEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "OpcionElegidaEnLinea";
