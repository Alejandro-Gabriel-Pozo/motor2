-- Compras N3-b, rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo): RLS por sucursal del control por línea de la recepción de una compra.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en ControlDeLineaDeRecepcion (alcance HEREDADA: no tiene `sucursalId`; su sucursal es la de su parte, `FacturaProveedorSucursal`, por `facturaProveedorSucursalId`),
-- con el alcance de sucursal que fija `conAlcanceEnSucursal` en cada transacción. Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe nada de esa tabla (falla cerrado; un INSERT da 42501).
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261117120100_compras_control_de_linea_de_recepcion (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["ControlDeLineaDeRecepcion"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117120110_rls_sucursal_control_de_linea_de_recepcion`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que 20261117120100.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- ControlDeLineaDeRecepcion
CREATE POLICY alcance_sucursal_select ON "ControlDeLineaDeRecepcion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "ControlDeLineaDeRecepcion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "ControlDeLineaDeRecepcion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "ControlDeLineaDeRecepcion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
