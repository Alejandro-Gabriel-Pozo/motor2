-- RLS por sucursal, B4: punto de venta (Paquete 1; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Mesas, cuentas, ítems y promos de la cuenta, tickets y el comprobante de idempotencia del pedido (AgregadoDeCuenta, de P3; hereda la sucursal de Cuenta). Requiere que 20261014100000_i3_agregado_de_cuenta esté aplicada.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en cada una de 6 tablas (24 en total), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna fila de estas tablas (falla cerrado; un INSERT da 42501). Requiere B1 aplicada y que el rol motor2_app exista
-- (scripts/operaciones/crear-rol-motor2-app.sql): sin él, CREATE POLICY falla y la migración no se aplica.
-- El código de la app fija el alcance desde A2 (src/server/sesion/base.ts). El código ANTERIOR a A2 solo fija la empresa: con estas políticas no vería filas de estas tablas.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance([...]) para estas tablas; test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261014140000_rls_sucursal_b4_punto_de_venta`). Sin políticas la app vuelve a ver todo lo de su empresa.
-- Se baja ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- AgregadoDeCuenta
CREATE POLICY alcance_sucursal_select ON "AgregadoDeCuenta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]))));
CREATE POLICY alcance_sucursal_insert ON "AgregadoDeCuenta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_update ON "AgregadoDeCuenta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))))
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_delete ON "AgregadoDeCuenta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));

-- Cuenta
CREATE POLICY alcance_sucursal_select ON "Cuenta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "Cuenta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "Cuenta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK ("mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "Cuenta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));

-- CuentaItem
CREATE POLICY alcance_sucursal_select ON "CuentaItem" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]))));
CREATE POLICY alcance_sucursal_insert ON "CuentaItem" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_update ON "CuentaItem" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))))
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_delete ON "CuentaItem" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));

-- EjemplarTicket
CREATE POLICY alcance_sucursal_select ON "EjemplarTicket" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "EjemplarTicket" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "EjemplarTicket" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "EjemplarTicket" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- Mesa
CREATE POLICY alcance_sucursal_select ON "Mesa" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Mesa" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Mesa" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Mesa" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- PromoCuenta
CREATE POLICY alcance_sucursal_select ON "PromoCuenta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]))));
CREATE POLICY alcance_sucursal_insert ON "PromoCuenta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_update ON "PromoCuenta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))))
  WITH CHECK ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
CREATE POLICY alcance_sucursal_delete ON "PromoCuenta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))));
