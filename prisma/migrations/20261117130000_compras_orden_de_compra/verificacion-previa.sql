-- Verificación previa de 20261117130000_compras_orden_de_compra (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117130000_compras_orden_de_compra/verificacion-previa.sql
-- ANTES: ninguna de las cinco tablas existe (existen = 0) y ya existe la tabla del control por línea de N3-b. DESPUÉS: existen las 5, todas con RLS y la app solo con SELECT e INSERT/UPDATE por columna (sin DELETE ni TRUNCATE).
BEGIN READ ONLY;

SELECT count(*) AS tablas_de_ordenes_existentes FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
   AND relname IN ('OrdenDeCompra', 'LineaDeOrdenDeCompra', 'SaldoDeLineaDeOrden', 'VinculoDeRenglonConOrden', 'NivelDeControl');
SELECT to_regclass('public."ControlDeLineaDeRecepcion"') IS NOT NULL AS existe_control_de_linea_n3b;
SELECT count(*) AS tablas_con_rls FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
   AND relname IN ('OrdenDeCompra', 'LineaDeOrdenDeCompra', 'SaldoDeLineaDeOrden', 'VinculoDeRenglonConOrden', 'NivelDeControl');
SELECT table_name, privilege_type::text AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'motor2_app'
   AND table_name IN ('OrdenDeCompra', 'LineaDeOrdenDeCompra', 'SaldoDeLineaDeOrden', 'VinculoDeRenglonConOrden', 'NivelDeControl') ORDER BY 1, 2;
-- Partes de compra pendientes de recibir hoy (la orden solo se vincula a una pendiente; el módulo `ordenes_de_compra` nace apagado):
SELECT count(*) AS partes_pendientes FROM "FacturaProveedorSucursal" WHERE "estadoRecepcion" = 'PENDIENTE';

ROLLBACK;
