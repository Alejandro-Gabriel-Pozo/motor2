-- Verificación previa de 20261117130000_caja_c3_cuenta_de_cobro (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real).
-- Esperado: C1 aplicada (las ocho tablas existen), las dos tablas nuevas NO existen todavía, versión de Postgres 15 o más, ICU disponible y ningún dato de C1 que la migración pueda violar (todas las columnas nuevas son NULL o false).
SELECT 'tablas_de_c1_presentes' AS control, count(*) AS cantidad
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('Caja', 'MedioDePago', 'SesionCaja', 'MovimientoCaja', 'Cobranza', 'Cobro', 'ArqueoCaja', 'ArqueoBillete'); -- 8
SELECT 'tablas_nuevas_que_ya_existen' AS control, count(*) AS cantidad
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('CuentaDeCobro', 'ValorDeLista'); -- 0
SELECT 'postgres_15_o_mas' AS control, current_setting('server_version_num')::int >= 150000 AS cumple;
SELECT 'icu_disponible' AS control, count(*) AS cantidad FROM pg_collation WHERE collprovider = 'i'; -- > 0
SELECT 'indice_unico_del_arqueo_de_c1' AS control, count(*) AS cantidad FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ArqueoCaja_empresaId_sesionId_medioDePagoId_key'; -- 1
SELECT 'medios_de_pago_existentes' AS control, count(*) AS cantidad FROM "MedioDePago";
