-- Verificación previa de 20261117160000_modo_de_orden_de_seccion_carta (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real y guardar la salida).
-- Resultado esperado: la tabla NO existe todavía, y `Sucursal`, `SeccionCarta` y `Empresa` (de las que cuelgan sus claves) SÍ existen. Es una migración que SOLO agrega una tabla: no hay datos existentes que puedan violar una regla nueva.
SELECT 'tabla_nueva_ya_existe' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ModoDeOrdenDeSeccionCarta';
SELECT 'tablas_de_las_que_cuelga' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Sucursal', 'SeccionCarta', 'Empresa');
SELECT rolname::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1;
-- Informativo: cuántas secciones de carta hay hoy (sin fila de modo, todas siguen a mano: nada cambia).
SELECT 'secciones' AS control, count(*) AS cantidad FROM "SeccionCarta";
