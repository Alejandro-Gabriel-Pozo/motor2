-- Verificación de 20261004120000_registro_de_modulos_por_empresa (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: tabla_nueva NULL; los roles que existan; y cuántas empresas hay por estado (el backfill les da 9 filas a cada una, sea cual sea su estado).
-- DESPUÉS: tabla_nueva = "ModuloEmpresa"; filas = empresas × 9; las 2 políticas, el RLS habilitado y los 2 triggers; privilegios de motor2_app SOLO SELECT.
SELECT to_regclass('public."ModuloEmpresa"')::text AS tabla_nueva;
SELECT rolname::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1;
SELECT "estado"::text AS estado_empresa, count(*) AS empresas FROM "Empresa" GROUP BY 1 ORDER BY 1;
SELECT count(*) AS filas, count(DISTINCT "empresaId") AS empresas_con_filas FROM "ModuloEmpresa";
SELECT policyname::text, cmd::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ModuloEmpresa' ORDER BY 1;
SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE oid = to_regclass('public."ModuloEmpresa"');
SELECT tgname::text AS trigger FROM pg_trigger WHERE tgrelid = to_regclass('public."ModuloEmpresa"') AND NOT tgisinternal ORDER BY 1;
SELECT grantee::text, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
  FROM information_schema.role_table_grants WHERE table_name = 'ModuloEmpresa' AND grantee IN ('motor2_app', 'motor2_plataforma') GROUP BY 1 ORDER BY 1;
SELECT "modulo", count(*) FROM "ModuloEmpresa" GROUP BY 1 ORDER BY 1;
