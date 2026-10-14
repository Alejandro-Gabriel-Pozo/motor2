-- GO-3d-rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal del PLATO DEL DÍA (ADR-032, D-1).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en EntradaDelDiaDeCupo (`PROPIA`: tiene `sucursalId`), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1).
-- Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ningún plato del día (falla cerrado; un INSERT da 42501): el encargado de una sucursal carga y ve solo los de la suya.
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261021100000_go3d_combos_y_menu_del_dia (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["EntradaDelDiaDeCupo"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261021101000_go3d_rls_sucursal_menu_del_dia`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que GO-3d y B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- EntradaDelDiaDeCupo
CREATE POLICY alcance_sucursal_select ON "EntradaDelDiaDeCupo" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "EntradaDelDiaDeCupo" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "EntradaDelDiaDeCupo" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "EntradaDelDiaDeCupo" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
