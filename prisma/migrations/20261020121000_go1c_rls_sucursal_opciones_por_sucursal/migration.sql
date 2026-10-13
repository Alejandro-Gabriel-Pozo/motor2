-- GO-1c-rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal de las opciones de venta por sucursal.
-- Crea 8 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en dos tablas, con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1): OpcionApagadaEnSucursal y PrecioLocalDeOpcion (las dos `PROPIA`: tienen `sucursalId`).
-- Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe nada de esas dos tablas (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo lo apagado y la grilla de precios de esa sucursal.
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261020120000_go1c_opciones_por_sucursal (las tablas): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["OpcionApagadaEnSucursal", "PrecioLocalDeOpcion"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261020121000_go1c_rls_sucursal_opciones_por_sucursal`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que GO-1c, GO-1b y B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- OpcionApagadaEnSucursal
CREATE POLICY alcance_sucursal_select ON "OpcionApagadaEnSucursal" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "OpcionApagadaEnSucursal" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "OpcionApagadaEnSucursal" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "OpcionApagadaEnSucursal" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- PrecioLocalDeOpcion
CREATE POLICY alcance_sucursal_select ON "PrecioLocalDeOpcion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "PrecioLocalDeOpcion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "PrecioLocalDeOpcion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "PrecioLocalDeOpcion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
