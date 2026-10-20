-- RETIRO DE GO-3a, políticas (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon; por ahora SOLO la base de producción): ola «precio y carta», Fase 3, paso 3.7 (ADR-032,
-- «Fase 3: retiro de GO-3a»). Saca las 8 políticas RESTRICTIVE de RLS por sucursal de las dos tablas de GO-3a que las tienen (CombinacionEnLinea y PrecioLocalDeCombinacion), que creó
-- 20261021111000_go3a_rls_sucursal_combinaciones. NO borra ni modifica datos: las tablas se borran en la migración siguiente (20261022101000_retiro_go3a), que ABORTA si encuentra una sola fila.
-- Va en una carpeta propia y ANTES que la de esquema: el guardián B7 (test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts) exige que una migración de políticas sea solo este encabezado de
-- comentarios y la salida EXACTA del generador: sqlDeReversaDePoliticasDeAlcance(["CombinacionEnLinea", "PrecioLocalDeCombinacion"]) (test/setup/politicas-de-alcance-de-sucursal.ts).
-- Requiere el código de la Fase 3 (>= paso 3.5) desplegado: nada del código vivo lee ni escribe estas tablas.
-- Si la migración siguiente ABORTA (hay datos de GO-3a), esta queda aplicada: las dos tablas quedan solo con la RLS por empresa hasta que se resuelva. Para volver al estado anterior, su down.sql
-- (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después borrar su fila de `_prisma_migrations` (`DELETE FROM _prisma_migrations WHERE migration_name = '20261022100000_retiro_go3a_rls'`; `prisma migrate resolve --rolled-back` responde P3012 sobre una migración ya aplicada)).
-- Reversa: down.sql (vuelve a crear las 8 políticas). Se baja DESPUÉS de bajar 20261022101000_retiro_go3a (las políticas necesitan las tablas).

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_update ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "CombinacionEnLinea";
DROP POLICY IF EXISTS alcance_sucursal_select ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_update ON "PrecioLocalDeCombinacion";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "PrecioLocalDeCombinacion";
