-- Paquete 5, M7.3: RLS por sucursal de los centros de costos (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Crea 12 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en tres tablas, con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1): PlanDeCostosSucursal (`PROPIA`: tiene `sucursalId`),
-- DistribucionCostoVersion (`HEREDADA` de ImputacionDeGasto por `imputacionDeGastoId`) y DistribucionCostoLinea (`HEREDADA` de DistribucionCostoVersion por `distribucionCostoVersionId`: cadena de dos niveles). Se combinan con AND con aislamiento_empresa.
-- Sin alcance en la transacción no se ve ni se escribe nada de esas tres tablas (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo las versiones y líneas de las imputaciones de esa sucursal. PlanDeCostos y CentroDeCostos son
-- DE_EMPRESA y NO llevan estas políticas. Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql), 20261016112000_imputacion_de_gasto, 20261019100000_planes_y_centros_de_costos y
-- 20261019101000_distribucion_de_costos (las tablas): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["DistribucionCostoLinea", "DistribucionCostoVersion", "PlanDeCostosSucursal"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261019102000_rls_sucursal_centros_de_costos`). No es destructiva (es una regresión de seguridad, no de datos). Se baja DESPUÉS de M7.4 y ANTES que M7.2, M7.1 y B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- DistribucionCostoLinea
CREATE POLICY alcance_sucursal_select ON "DistribucionCostoLinea" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("distribucionCostoVersionId" IN (SELECT "id" FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]))));
CREATE POLICY alcance_sucursal_insert ON "DistribucionCostoLinea" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("distribucionCostoVersionId" IN (SELECT "id" FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_update ON "DistribucionCostoLinea" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("distribucionCostoVersionId" IN (SELECT "id" FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))))
  WITH CHECK ("distribucionCostoVersionId" IN (SELECT "id" FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_delete ON "DistribucionCostoLinea" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("distribucionCostoVersionId" IN (SELECT "id" FROM "DistribucionCostoVersion" WHERE "imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));

-- DistribucionCostoVersion
CREATE POLICY alcance_sucursal_select ON "DistribucionCostoVersion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "DistribucionCostoVersion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "DistribucionCostoVersion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK ("imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "DistribucionCostoVersion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("imputacionDeGastoId" IN (SELECT "id" FROM "ImputacionDeGasto" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));

-- PlanDeCostosSucursal
CREATE POLICY alcance_sucursal_select ON "PlanDeCostosSucursal" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "PlanDeCostosSucursal" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "PlanDeCostosSucursal" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "PlanDeCostosSucursal" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
