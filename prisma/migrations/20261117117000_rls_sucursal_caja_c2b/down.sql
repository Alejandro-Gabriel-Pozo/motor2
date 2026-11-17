-- Reversa de 20261117117000_rls_sucursal_caja_c2b (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117117000_rls_sucursal_caja_c2b`).
-- Solo borra las 4 políticas de alcance de las tres tablas de la foto de la conciliación: la app vuelve a ver todo lo de su empresa en esas tablas (regresión de seguridad, no de datos). Se baja ANTES que 20261117116000_caja_c2b_conciliacion.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "CierreDeCajaDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CierreDeCajaDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CierreDeCajaDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CierreDeCajaDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_select ON "ConciliacionDeCobroPorOrigen";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ConciliacionDeCobroPorOrigen";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ConciliacionDeCobroPorOrigen";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ConciliacionDeCobroPorOrigen";
DROP POLICY IF EXISTS alcance_sucursal_select ON "ConciliacionDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ConciliacionDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ConciliacionDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ConciliacionDeJornada";
