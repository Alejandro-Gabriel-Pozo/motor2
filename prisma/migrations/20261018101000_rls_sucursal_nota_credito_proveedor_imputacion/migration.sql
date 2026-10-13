-- M6.2 (Paquete 4) (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal de la imputación de una nota de crédito de proveedor a cada sucursal.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en NotaCreditoProveedorImputacion (`PROPIA`: tiene `sucursalId`), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna imputación (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo lo que le tocó a esa sucursal. La cabecera, las líneas y los tributos de la nota
-- son DE_EMPRESA y NO llevan estas políticas. Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261018100000_nota_credito_proveedor (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["NotaCreditoProveedorImputacion"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261018101000_rls_sucursal_nota_credito_proveedor_imputacion`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que M6.1 y ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- NotaCreditoProveedorImputacion
CREATE POLICY alcance_sucursal_select ON "NotaCreditoProveedorImputacion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "NotaCreditoProveedorImputacion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "NotaCreditoProveedorImputacion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "NotaCreditoProveedorImputacion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
