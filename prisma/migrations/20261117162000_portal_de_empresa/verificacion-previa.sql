-- Verificación previa de 20261117162000_portal_de_empresa (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real y guardar la salida).
-- Resultado esperado: las tablas nuevas y las tres funciones NO existen todavía, y `Empresa` y `Sucursal` (de las que cuelgan sus claves) SÍ existen. Solo agrega tablas y funciones: no hay datos existentes que puedan violar una regla nueva.
SELECT 'tablas_nuevas_ya_existen' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('PortalDeEmpresa', 'PortalTarjeta', 'PortalZona');
SELECT 'funciones_nuevas_ya_existen' AS control, count(*) AS cantidad FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('texto_de_catalogo_valido', 'color_de_carta_valido', 'imagen_externa_valida');
SELECT 'tablas_de_las_que_cuelga' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Empresa', 'Sucursal');
SELECT rolname::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1;
-- Informativo (inventario previo para el backfill, que va aparte): sucursales publicadas hoy y empresas con apariencia cargada en el Json.
SELECT 'sucursales_publicadas' AS control, count(*) AS cantidad FROM "SucursalPublica" WHERE "publicada";
SELECT 'empresas_con_portal_json' AS control, count(*) AS cantidad FROM "PortalCartaEmpresa";
