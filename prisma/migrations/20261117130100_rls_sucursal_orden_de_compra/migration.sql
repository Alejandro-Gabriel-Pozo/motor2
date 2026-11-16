-- Compras, orden de compra, rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo): RLS por sucursal de la orden de compra, sus líneas, sus saldos y el vínculo de un renglón de una compra pendiente con una línea de orden.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en cada una de OrdenDeCompra (alcance PROPIA_O_EMPRESA: `sucursalId` es la sucursal destino, informativa y OPCIONAL; NULL = toda la empresa), LineaDeOrdenDeCompra y SaldoDeLineaDeOrden
-- (HEREDADA de su orden por `ordenId`) y VinculoDeRenglonConOrden (HEREDADA de su parte, `FacturaProveedorSucursal`, por `facturaProveedorSucursalId`), con el alcance de sucursal que fija `conAlcanceEnSucursal` en cada transacción. Se combinan con AND con aislamiento_empresa.
-- Sin alcance en la transacción no se ve ni se escribe nada de esas tablas (falla cerrado; un INSERT da 42501). Para cerrar o anular una orden (que mira los vínculos de TODAS las sucursales) el caso de uso abre la transacción con la base de VERIFICACIÓN (lectura en toda la empresa).
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261117130000_compras_orden_de_compra (las tablas): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117130100_rls_sucursal_orden_de_compra`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que 20261117130000.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- LineaDeOrdenDeCompra
CREATE POLICY alcance_sucursal_select ON "LineaDeOrdenDeCompra" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_insert ON "LineaDeOrdenDeCompra" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_update ON "LineaDeOrdenDeCompra" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))))
  WITH CHECK ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_delete ON "LineaDeOrdenDeCompra" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));

-- OrdenDeCompra
CREATE POLICY alcance_sucursal_select ON "OrdenDeCompra" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_insert ON "OrdenDeCompra" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_update ON "OrdenDeCompra" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_delete ON "OrdenDeCompra" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));

-- SaldoDeLineaDeOrden
CREATE POLICY alcance_sucursal_select ON "SaldoDeLineaDeOrden" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_insert ON "SaldoDeLineaDeOrden" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_update ON "SaldoDeLineaDeOrden" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))))
  WITH CHECK ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_delete ON "SaldoDeLineaDeOrden" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("ordenId" IN (SELECT "id" FROM "OrdenDeCompra" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));

-- VinculoDeRenglonConOrden
CREATE POLICY alcance_sucursal_select ON "VinculoDeRenglonConOrden" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "VinculoDeRenglonConOrden" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "VinculoDeRenglonConOrden" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "VinculoDeRenglonConOrden" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("facturaProveedorSucursalId" IN (SELECT "id" FROM "FacturaProveedorSucursal" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
