-- Reversa de 20261117121000_rls_sucursal_caja_c2 (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117121000_rls_sucursal_caja_c2`).
-- Solo borra las 4 políticas de alcance de las cinco tablas de la jornada: la app vuelve a ver todo lo de su empresa en esas tablas (regresión de seguridad, no de datos). Se baja ANTES que 20261117120000_caja_c2_jornada.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ConformeDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ConformeDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ConformeDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ConformeDeJornada";
DROP POLICY IF EXISTS alcance_sucursal_select ON "ControlDeJornadaCerrada";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ControlDeJornadaCerrada";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ControlDeJornadaCerrada";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ControlDeJornadaCerrada";
DROP POLICY IF EXISTS alcance_sucursal_select ON "CorreccionDeMedio";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CorreccionDeMedio";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CorreccionDeMedio";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CorreccionDeMedio";
DROP POLICY IF EXISTS alcance_sucursal_select ON "DeclaracionDeTotal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "DeclaracionDeTotal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "DeclaracionDeTotal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "DeclaracionDeTotal";
DROP POLICY IF EXISTS alcance_sucursal_select ON "JornadaDeSucursal";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "JornadaDeSucursal";
DROP POLICY IF EXISTS alcance_sucursal_update ON "JornadaDeSucursal";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "JornadaDeSucursal";
