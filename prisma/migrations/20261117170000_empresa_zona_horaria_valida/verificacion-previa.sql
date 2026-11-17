-- Verificación de 20261117170000_empresa_zona_horaria_valida (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: la lista de empresas con zona que Postgres no reconoce debe estar VACÍA (si no, la migración aborta). DESPUÉS: existen la función y el disparador.
SELECT "id", "zonaHoraria" FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = e."zonaHoraria") ORDER BY 1;
SELECT count(*) AS empresas FROM "Empresa";
SELECT proname::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('zona_horaria_valida', 'empresa_validar_zona_horaria') ORDER BY 1;
SELECT tgname::text FROM pg_trigger WHERE tgrelid = to_regclass('public."Empresa"') AND tgname = 'Empresa_zona_horaria_valida';
