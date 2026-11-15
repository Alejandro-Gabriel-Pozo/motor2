-- Verificación de 20261115120000_ocultamiento_de_producto (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: tabla_nueva NULL y los roles que existan. DESPUÉS: tabla_nueva = "OcultamientoProducto", 0 filas, los 2 índices únicos parciales, las 4 claves, las 2 reglas, RLS habilitado con la política de empresa y
-- privilegios de motor2_app SOLO SELECT, INSERT y UPDATE de 4 columnas (sin DELETE).
SELECT to_regclass('public."OcultamientoProducto"')::text AS tabla_nueva;
SELECT rolname::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1;
SELECT count(*) AS filas FROM "OcultamientoProducto";
SELECT indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'OcultamientoProducto' ORDER BY 1;
SELECT conname::text, contype::text FROM pg_constraint WHERE conrelid = to_regclass('public."OcultamientoProducto"') ORDER BY 1;
SELECT policyname::text, cmd::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'OcultamientoProducto' ORDER BY 1;
SELECT relrowsecurity AS rls FROM pg_class WHERE oid = to_regclass('public."OcultamientoProducto"');
SELECT grantee::text, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
  FROM information_schema.role_table_grants WHERE table_name = 'OcultamientoProducto' AND grantee IN ('motor2_app', 'motor2_plataforma') GROUP BY 1 ORDER BY 1;
SELECT grantee::text, column_name::text, privilege_type FROM information_schema.column_privileges
  WHERE table_name = 'OcultamientoProducto' AND grantee = 'motor2_app' AND privilege_type = 'UPDATE' ORDER BY 2;
