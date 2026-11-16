-- Reversa de 20261117111000_rls_sucursal_caja_c1 (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117111000_rls_sucursal_caja_c1`).
-- Solo borra las 4 políticas de alcance de las siete tablas de dinero de una sucursal: la app vuelve a ver todo lo de su empresa en esas tablas (regresión de seguridad, no de datos). Se baja ANTES que 20261117110000_caja_c1.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "ArqueoBillete";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ArqueoBillete";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ArqueoBillete";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ArqueoBillete";
DROP POLICY IF EXISTS alcance_sucursal_select ON "ArqueoCaja";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "ArqueoCaja";
DROP POLICY IF EXISTS alcance_sucursal_update ON "ArqueoCaja";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "ArqueoCaja";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Caja";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Caja";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Caja";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Caja";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Cobranza";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Cobranza";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Cobranza";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Cobranza";
DROP POLICY IF EXISTS alcance_sucursal_select ON "Cobro";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "Cobro";
DROP POLICY IF EXISTS alcance_sucursal_update ON "Cobro";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "Cobro";
DROP POLICY IF EXISTS alcance_sucursal_select ON "MovimientoCaja";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "MovimientoCaja";
DROP POLICY IF EXISTS alcance_sucursal_update ON "MovimientoCaja";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "MovimientoCaja";
DROP POLICY IF EXISTS alcance_sucursal_select ON "SesionCaja";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "SesionCaja";
DROP POLICY IF EXISTS alcance_sucursal_update ON "SesionCaja";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "SesionCaja";
