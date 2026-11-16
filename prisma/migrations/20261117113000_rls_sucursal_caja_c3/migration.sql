-- Caja y cobro C3, RLS por sucursal (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alcance de sucursal de la cuenta de cobro.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en CuentaDeCobro (alcance PROPIA: `sucursalId` de la fila = una sucursal del alcance del usuario). Se combinan con AND con aislamiento_empresa.
-- Sin alcance en la transacción no se ve ni se escribe nada de esa tabla (falla cerrado; un INSERT da 42501). Cambiar una cuenta de sucursal exige alcance de escritura sobre las DOS.
-- Requiere B1 aplicada, que el rol motor2_app exista y 20261117112000_caja_c3_cuenta_de_cobro (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance([...]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117113000_rls_sucursal_caja_c3`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que 20261117112000_caja_c3_cuenta_de_cobro.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- CuentaDeCobro
CREATE POLICY alcance_sucursal_select ON "CuentaDeCobro" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "CuentaDeCobro" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "CuentaDeCobro" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "CuentaDeCobro" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
