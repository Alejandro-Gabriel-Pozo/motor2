-- «Ocultar» como Pedernal, E3a-rls (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): RLS por sucursal de la marca de ocultar de un producto.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en OcultamientoProducto (alcance PROPIA_O_EMPRESA: `sucursalId` con valor = de esa sucursal; NULL = de toda la empresa, que solo cuenta con un alcance fijado), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1).
-- Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe nada de esa tabla (falla cerrado; un INSERT da 42501). Quién puede escribir la fila de EMPRESA (solo administración, O-10) lo decide el caso de uso, no esta política (decisión técnica 2 del diseño; precedente RecetaVersion).
-- Requiere B1 aplicada, que el rol motor2_app exista (scripts/operaciones/crear-rol-motor2-app.sql) y 20261115120000_ocultamiento_de_producto (la tabla): sin ellos, CREATE POLICY falla y la migración no se aplica. NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["OcultamientoProducto"]) (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261115121000_rls_sucursal_ocultamiento_de_producto`). No es destructiva (es una regresión de seguridad, no de datos). Se baja ANTES que 20261115120000 y que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- OcultamientoProducto
CREATE POLICY alcance_sucursal_select ON "OcultamientoProducto" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_insert ON "OcultamientoProducto" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_update ON "OcultamientoProducto" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_delete ON "OcultamientoProducto" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
