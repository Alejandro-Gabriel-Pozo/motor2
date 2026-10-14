-- GO-3a-rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal de las combinaciones (ADR-032, frente A).
-- Crea 8 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en dos tablas, con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1): PrecioLocalDeCombinacion (`PROPIA`: tiene `sucursalId`) y
-- CombinacionEnLinea (`HEREDADA` de CuentaItem por `cuentaItemId`, y de ahí de Cuenta y de Mesa: cadena de tres niveles hasta la sucursal).
-- Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe nada de esas dos tablas (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo sus precios locales y las fotos de sus mesas.
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql), B4 (Mesa, Cuenta y CuentaItem con sus políticas) y 20261021110000_go3a_combinaciones (las tablas): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["CombinacionEnLinea", "PrecioLocalDeCombinacion"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261021111000_go3a_rls_sucursal_combinaciones`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que GO-3a y B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- CombinacionEnLinea
CREATE POLICY alcance_sucursal_select ON "CombinacionEnLinea" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])))));
CREATE POLICY alcance_sucursal_insert ON "CombinacionEnLinea" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));
CREATE POLICY alcance_sucursal_update ON "CombinacionEnLinea" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))))
  WITH CHECK ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));
CREATE POLICY alcance_sucursal_delete ON "CombinacionEnLinea" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));

-- PrecioLocalDeCombinacion
CREATE POLICY alcance_sucursal_select ON "PrecioLocalDeCombinacion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "PrecioLocalDeCombinacion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "PrecioLocalDeCombinacion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "PrecioLocalDeCombinacion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
