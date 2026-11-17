-- Reversa de 20261117160100_rls_sucursal_modo_de_orden_de_seccion_carta (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117160100_rls_sucursal_modo_de_orden_de_seccion_carta`).
-- Solo borra las 4 políticas de alcance de ModoDeOrdenDeSeccionCarta: la app vuelve a ver todo lo de su empresa en esa tabla (regresión de seguridad, no de datos). Se baja ANTES que 20261117160000.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ModoDeOrdenDeSeccionCarta";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ModoDeOrdenDeSeccionCarta";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ModoDeOrdenDeSeccionCarta";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ModoDeOrdenDeSeccionCarta";
