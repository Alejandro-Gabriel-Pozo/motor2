-- Verificación previa de 20261117120100_compras_control_de_linea_de_recepcion (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: la tabla no existe (existe = false). DESPUÉS: existe, con RLS, y la app solo tiene SELECT e INSERT.
BEGIN READ ONLY;

SELECT to_regclass('public."ControlDeLineaDeRecepcion"') IS NOT NULL AS existe;
SELECT count(*) AS controles FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'ControlDeLineaDeRecepcion' AND relrowsecurity;
SELECT privilege_type::text AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ControlDeLineaDeRecepcion' AND grantee = 'motor2_app' ORDER BY 1;
-- Partes pendientes hoy (el control solo se registra sobre una pendiente; deben ser 0 antes de encender el módulo en una empresa):
SELECT count(*) AS partes_pendientes FROM "FacturaProveedorSucursal" WHERE "estadoRecepcion" = 'PENDIENTE';

ROLLBACK;
