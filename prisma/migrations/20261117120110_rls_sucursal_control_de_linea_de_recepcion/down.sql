-- Reversa de 20261117120110_rls_sucursal_control_de_linea_de_recepcion (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117120110_rls_sucursal_control_de_linea_de_recepcion`).
-- Solo borra las 4 políticas de alcance de ControlDeLineaDeRecepcion: la app vuelve a ver todo lo de su empresa en esa tabla (regresión de seguridad, no de datos). Se baja ANTES que 20261117120100.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ControlDeLineaDeRecepcion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ControlDeLineaDeRecepcion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ControlDeLineaDeRecepcion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ControlDeLineaDeRecepcion";
