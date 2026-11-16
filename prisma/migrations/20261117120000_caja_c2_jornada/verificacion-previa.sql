-- Verificación previa de 20261117120000_caja_c2_jornada (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real). Resultado esperado: las cinco tablas y las tres columnas NO existen todavía, los nombres de función están libres
-- y C1 está aplicada (las cuatro tablas que la migración amplía existen: `tablas_de_c1_que_faltan` = 0).
SELECT 'tablas_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('JornadaDeSucursal', 'ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada');
SELECT 'columnas_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.columns
 WHERE table_schema = 'public' AND ((table_name = 'Sucursal' AND column_name = 'horaDeCorte') OR (table_name = 'SesionCaja' AND column_name = 'horaDeCorte') OR (table_name = 'MovimientoCaja' AND column_name = 'corrigeJornada'));
SELECT 'funciones_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('caja_fecha_de_negocio', 'JornadaDeSucursal_validar_cambio', 'JornadaDeSucursal_exigir_estado', 'ControlDeJornadaCerrada_validar', 'CorreccionDeMedio_validar', 'DeclaracionDeTotal_validar', 'ConformeDeJornada_validar');
SELECT 'tablas_de_c1_que_faltan' AS control, 4 - count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('SesionCaja', 'MovimientoCaja', 'Cobro', 'MedioDePago');
-- Informativo: las sesiones de C1 que ya existen reciben su jornada ABIERTA al aplicarla (una por sucursal y fecha de negocio).
SELECT 'jornadas_que_se_crearian' AS control, count(*) AS cantidad
  FROM (SELECT 1 FROM "SesionCaja" GROUP BY "empresaId", "sucursalId", "fechaDeNegocio") x;
