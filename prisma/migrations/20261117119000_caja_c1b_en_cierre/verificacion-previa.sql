-- Verificación previa de 20261117119000_caja_c1b_en_cierre (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real). Es ADITIVA: agrega dos columnas nulas y amplía dos CHECK.
-- Resultado esperado: las columnas NO existen todavía; la función nueva NO existe; los dos CHECK de C1 SÍ existen (cantidad 2); y todas las sesiones existentes son ABIERTA o CERRADA (los CHECK nuevos las aceptan tal cual).
SELECT 'columnas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'SesionCaja' AND column_name IN ('cierreIniciadoEn', 'cierreIniciadoPorId');
SELECT 'funcion_nueva_que_ya_existe' AS control, count(*) AS cantidad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'SesionCaja_exigir_en_cierre';
SELECT 'check_de_c1_presentes' AS control, count(*) AS cantidad
  FROM pg_constraint WHERE conrelid = '"SesionCaja"'::regclass AND conname IN ('SesionCaja_estado_chk', 'SesionCaja_marcas_chk');
SELECT 'sesiones_por_estado' AS control, "estado", count(*) AS cantidad FROM "SesionCaja" GROUP BY "estado" ORDER BY 2;
