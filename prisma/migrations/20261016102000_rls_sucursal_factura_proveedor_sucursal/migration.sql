-- M3c (Paquete 3): RLS por sucursal de la parte de cada sucursal en una factura de proveedor repartida (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en FacturaProveedorSucursal (`PROPIA`: tiene `sucursalId`), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna parte (falla cerrado; un INSERT da 42501). La cabecera (FacturaProveedor) y el renglón son DE_EMPRESA y NO llevan estas políticas: desde cualquier sucursal
-- de la empresa se ve la cabecera de la propia parte (el qué se muestra lo decide el gate). Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261016101000_factura_proveedor
-- (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["FacturaProveedorSucursal"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016102000_rls_sucursal_factura_proveedor_sucursal`). No es destructiva. Se baja ANTES que M3b y ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- FacturaProveedorSucursal
CREATE POLICY alcance_sucursal_select ON "FacturaProveedorSucursal" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "FacturaProveedorSucursal" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "FacturaProveedorSucursal" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "FacturaProveedorSucursal" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
