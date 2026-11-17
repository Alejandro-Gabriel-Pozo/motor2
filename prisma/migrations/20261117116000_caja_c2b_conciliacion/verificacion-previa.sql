-- Verificación previa de 20261117116000_caja_c2b_conciliacion (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real). Resultado esperado: las tres tablas y las cuatro funciones NO existen todavía y C2 está aplicada (`tablas_de_c2_que_faltan` = 0).
-- Es una migración que SOLO agrega tablas: no hay datos existentes que puedan violar una regla nueva.
SELECT 'tablas_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('CierreDeCajaDeJornada', 'ConciliacionDeJornada', 'ConciliacionDeCobroPorOrigen');
SELECT 'funciones_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('CierreDeCajaDeJornada_validar', 'ConciliacionDeJornada_validar', 'ConciliacionDeCobroPorOrigen_validar', 'CierreDeCajaDeJornada_verificar');
SELECT 'tablas_de_c2_que_faltan' AS control, 5 - count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('JornadaDeSucursal', 'ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada');
-- Informativo: jornadas ya cerradas ANTES de aplicarla (no tendrán foto de conciliación: se cerraron sin ella). Esperado 0 mientras C2 no esté aplicada en ninguna base real.
SELECT 'jornadas_cerradas_sin_foto' AS control, count(*) AS cantidad FROM "JornadaDeSucursal" WHERE "estado" = 'CERRADA';
