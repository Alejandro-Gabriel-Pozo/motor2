-- Verificación previa de 20261117110000_caja_c1 (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real). Resultado esperado: las ocho tablas NO existen todavía y los nombres de función están libres.
-- Es una migración que SOLO agrega tablas: no hay datos existentes que puedan violar una regla nueva.
SELECT 'tablas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('Caja', 'MedioDePago', 'SesionCaja', 'MovimientoCaja', 'Cobranza', 'Cobro', 'ArqueoCaja', 'ArqueoBillete');
SELECT 'funciones_que_ya_existen' AS control, count(*) AS cantidad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('SesionCaja_validar', 'SesionCaja_exigir_abierta', 'MovimientoCaja_validar', 'Cobranza_validar', 'Cobro_validar', 'Cobranza_cuadra', 'Arqueo_validar', 'SesionCaja_verificar_cierre');
-- Cuentas cerradas que quedarían «sin cobrar» al activar la caja (informativo; el tratamiento de las anteriores a la caja es la pregunta Q-ANT).
SELECT 'cuentas_cerradas_existentes' AS control, count(*) AS cantidad FROM "Cuenta" WHERE "cerradaEn" IS NOT NULL;
