-- M4.4 (Paquete 3): RLS por sucursal de la imputación de un gasto a cada sucursal (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en ImputacionDeGasto (`PROPIA`: tiene `sucursalId`), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna imputación (falla cerrado; un INSERT da 42501): quien ve una sola sucursal ve solo lo que le tocó a esa sucursal. El renglón del gasto y la cabecera de la factura
-- son DE_EMPRESA y NO llevan estas políticas. Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261016112000_imputacion_de_gasto (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["ImputacionDeGasto"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016113000_rls_sucursal_imputacion_de_gasto`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que M4.3 y ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- ImputacionDeGasto
CREATE POLICY alcance_sucursal_select ON "ImputacionDeGasto" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]));
CREATE POLICY alcance_sucursal_insert ON "ImputacionDeGasto" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_update ON "ImputacionDeGasto" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))
  WITH CHECK ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
CREATE POLICY alcance_sucursal_delete ON "ImputacionDeGasto" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]));
