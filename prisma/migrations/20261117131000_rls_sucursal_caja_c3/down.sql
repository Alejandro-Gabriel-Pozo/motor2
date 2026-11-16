-- Reversa de 20261117131000_rls_sucursal_caja_c3 (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117131000_rls_sucursal_caja_c3`).
-- Solo borra las 4 políticas de alcance de CuentaDeCobro: la app vuelve a ver todo lo de su empresa en esa tabla (regresión de seguridad, no de datos). Se baja ANTES que 20261117130000_caja_c3_cuenta_de_cobro.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "CuentaDeCobro";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CuentaDeCobro";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CuentaDeCobro";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CuentaDeCobro";
