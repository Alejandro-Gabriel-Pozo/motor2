-- RLS por sucursal, B5: stock y dinero (Paquete 1; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Secciones, operaciones, movimientos de stock (heredan de la sección), conteos físicos, pagos a consignantes y traspasos (visibles y escribibles desde el origen o el destino).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en cada una de 6 tablas (24 en total), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna fila de estas tablas (falla cerrado; un INSERT da 42501). Requiere B1 aplicada y que el rol motor2_app exista
-- (scripts/operaciones/crear-rol-motor2-app.sql): sin él, CREATE POLICY falla y la migración no se aplica.
-- El código de la app fija el alcance desde A2 (src/server/sesion/base.ts). El código ANTERIOR a A2 solo fija la empresa: con estas políticas no vería filas de estas tablas.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance([...]) para estas tablas; test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261014150000_rls_sucursal_b5_stock_y_dinero`). Sin políticas la app vuelve a ver todo lo de su empresa.
-- Se baja ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- ConteoFisico
CREATE POLICY alcance_sucursal_select ON "ConteoFisico" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "ConteoFisico" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "ConteoFisico" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "ConteoFisico" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- MovimientoStock
CREATE POLICY alcance_sucursal_select ON "MovimientoStock" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "MovimientoStock" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "MovimientoStock" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK ("seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "MovimientoStock" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));

-- Operacion
CREATE POLICY alcance_sucursal_select ON "Operacion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Operacion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Operacion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Operacion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- PagoConsignante
CREATE POLICY alcance_sucursal_select ON "PagoConsignante" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "PagoConsignante" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "PagoConsignante" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "PagoConsignante" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- Seccion
CREATE POLICY alcance_sucursal_select ON "Seccion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Seccion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Seccion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Seccion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- TraspasoSucursal
CREATE POLICY alcance_sucursal_select ON "TraspasoSucursal" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "TraspasoSucursal" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "TraspasoSucursal" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "TraspasoSucursal" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
