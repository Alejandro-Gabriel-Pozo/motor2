-- Carta, orden de renglones O1, RLS por sucursal (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alcance de sucursal del modo de orden de una sección.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en ModoDeOrdenDeSeccionCarta (alcance PROPIA: `sucursalId` de la fila = una sucursal del alcance del usuario). Se combinan con AND con aislamiento_empresa.
-- Sin alcance en la transacción no se ve ni se escribe nada de esa tabla (falla cerrado; un INSERT da 42501). Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261117160000_modo_de_orden_de_seccion_carta (la tabla).
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["ModoDeOrdenDeSeccionCarta"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117160100_rls_sucursal_modo_de_orden_de_seccion_carta`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que 20261117160000.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- ModoDeOrdenDeSeccionCarta
CREATE POLICY alcance_sucursal_select ON "ModoDeOrdenDeSeccionCarta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "ModoDeOrdenDeSeccionCarta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "ModoDeOrdenDeSeccionCarta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "ModoDeOrdenDeSeccionCarta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
