-- Reversa de 20261014160000_rls_sucursal_b6_receta_y_auditoria: DROP POLICY IF EXISTS de las 24 políticas (idempotente). No toca datos. Bajar ANTES que B1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014160000_rls_sucursal_b6_receta_y_auditoria`.
-- Al bajarla, las tablas del grupo quedan solo con la RLS por empresa: la app ve las filas de TODAS las sucursales de su empresa.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "RecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RecetaPaso";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RecetaPaso";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RecetaPaso";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RecetaPaso";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RecetaPasoIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RecetaPasoIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RecetaPasoIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RecetaPasoIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RecetaVersion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RecetaVersion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RecetaVersion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RecetaVersion";
DROP POLICY IF EXISTS alcance_sucursal_select ON "RegistroAuditoria";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "RegistroAuditoria";
DROP POLICY IF EXISTS alcance_sucursal_update ON "RegistroAuditoria";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "RegistroAuditoria";
DROP POLICY IF EXISTS alcance_sucursal_select ON "SustitutoRecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "SustitutoRecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_update ON "SustitutoRecetaIngrediente";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "SustitutoRecetaIngrediente";
