-- M2-4 (Paquete 2): RLS por sucursal de la cabecera de venta (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en Venta (`PROPIA`: tiene `sucursalId`), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna cabecera (falla cerrado; un INSERT da 42501). Requiere B1 aplicada, que el rol motor2_app exista
-- (scripts/operaciones/crear-rol-motor2-app.sql) y 20261015122000_m2_cabecera_de_venta (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["Venta"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261015123000_m2_rls_sucursal_venta`). Se baja ANTES que M2-3 y ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- Venta
CREATE POLICY alcance_sucursal_select ON "Venta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Venta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Venta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Venta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
