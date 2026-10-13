-- GO-1d-rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal de la foto de las opciones elegidas en una línea.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en OpcionElegidaEnLinea (`HEREDADA` de CuentaItem por `cuentaItemId`, y de ahí de Cuenta y de Mesa: cadena de tres niveles hasta la sucursal), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1).
-- Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna foto (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo la foto de las líneas de las mesas de esa sucursal.
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql), B4 (Mesa, Cuenta y CuentaItem con sus políticas) y 20261020130000_go1d_linea_con_opciones (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["OpcionElegidaEnLinea"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261020131000_go1d_rls_sucursal_opcion_elegida`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que GO-1d, GO-1c-rls y B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- OpcionElegidaEnLinea
CREATE POLICY alcance_sucursal_select ON "OpcionElegidaEnLinea" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])))));
CREATE POLICY alcance_sucursal_insert ON "OpcionElegidaEnLinea" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));
CREATE POLICY alcance_sucursal_update ON "OpcionElegidaEnLinea" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))))
  WITH CHECK ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));
CREATE POLICY alcance_sucursal_delete ON "OpcionElegidaEnLinea" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("cuentaItemId" IN (SELECT "id" FROM "CuentaItem" WHERE "cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))));
