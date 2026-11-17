-- Verificación previa de 20261117161000_familias_de_producto (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real y guardar la salida).
-- Resultado esperado: las tablas nuevas NO existen todavía, y `Empresa`, `Producto` y `OpcionItemAgrupadoCarta` (de las que cuelgan sus claves y su disparador) SÍ existen. Solo agrega tablas y un disparador: no hay datos existentes que puedan violar una regla nueva
-- (los disparadores no revalidan filas viejas).
SELECT 'tablas_nuevas_ya_existen' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('FamiliaDeProducto', 'MiembroDeFamilia');
SELECT 'tablas_de_las_que_cuelga' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Empresa', 'Producto', 'OpcionItemAgrupadoCarta');
SELECT rolname::text, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma') ORDER BY 1;
-- Informativo (inventario previo del cruce): cuántos productos hay hoy en un ítem agrupado (por sucursal). Hoy no puede haber conflicto cargado: las familias no existen.
SELECT 'productos_en_items_agrupados' AS control, count(DISTINCT ("empresaId", "productoId")) AS cantidad FROM "OpcionItemAgrupadoCarta";
SELECT 'opciones_de_items_agrupados' AS control, count(*) AS cantidad FROM "OpcionItemAgrupadoCarta";
