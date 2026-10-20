-- Reversa de 20261022100000_retiro_go3a_rls (retiro de GO-3a, políticas): vuelve a crear las 8 políticas RESTRICTIVE de RLS por sucursal de CombinacionEnLinea y PrecioLocalDeCombinacion, con el
-- mismo SQL que 20261021111000_go3a_rls_sucursal_combinaciones: la salida EXACTA de sqlDePoliticasDeAlcance(["CombinacionEnLinea", "PrecioLocalDeCombinacion"]) (B7 lo exige).
-- No toca datos. Se corre DESPUÉS del down.sql de 20261022101000_retiro_go3a (las tablas tienen que existir) y ANTES de bajar B1 (las funciones del alcance).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261022100000_retiro_go3a_rls`.

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
