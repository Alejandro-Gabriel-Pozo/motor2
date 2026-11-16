-- Caja y cobro C1, RLS por sucursal (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alcance de sucursal de las tablas de dinero de una sucursal.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en Caja, SesionCaja, MovimientoCaja, Cobranza, Cobro, ArqueoCaja y ArqueoBillete (alcance PROPIA: `sucursalId` de la fila = una sucursal del alcance del usuario).
-- `MedioDePago` queda solo con la política de empresa: es de la empresa entera. Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe nada de esas tablas (falla cerrado; un INSERT da 42501).
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261117110000_caja_c1 (las tablas): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance([...]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117111000_rls_sucursal_caja_c1`). No es destructiva (es una regresión de seguridad, no de datos).

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- ArqueoBillete
CREATE POLICY alcance_sucursal_select ON "ArqueoBillete" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "ArqueoBillete" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "ArqueoBillete" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "ArqueoBillete" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- ArqueoCaja
CREATE POLICY alcance_sucursal_select ON "ArqueoCaja" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "ArqueoCaja" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "ArqueoCaja" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "ArqueoCaja" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- Caja
CREATE POLICY alcance_sucursal_select ON "Caja" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Caja" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Caja" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Caja" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- Cobranza
CREATE POLICY alcance_sucursal_select ON "Cobranza" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Cobranza" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Cobranza" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Cobranza" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- Cobro
CREATE POLICY alcance_sucursal_select ON "Cobro" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "Cobro" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "Cobro" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "Cobro" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- MovimientoCaja
CREATE POLICY alcance_sucursal_select ON "MovimientoCaja" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "MovimientoCaja" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "MovimientoCaja" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "MovimientoCaja" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));

-- SesionCaja
CREATE POLICY alcance_sucursal_select ON "SesionCaja" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "SesionCaja" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "SesionCaja" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "SesionCaja" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
