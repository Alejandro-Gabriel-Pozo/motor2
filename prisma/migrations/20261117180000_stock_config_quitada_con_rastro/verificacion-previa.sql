-- Verificación de 20261117180000_stock_config_quitada_con_rastro (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: las columnas no existen. DESPUÉS: existen. En los dos casos: cuántas filas hay por tabla.
SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('StockMinimoProducto','SeccionHabitualProducto','FrecuenciaConteoProducto') AND column_name IN ('quitadoEn','quitadoPorId') ORDER BY 1, 2;
SELECT 'StockMinimoProducto' AS tabla, count(*) AS filas FROM "StockMinimoProducto" UNION ALL SELECT 'SeccionHabitualProducto', count(*) FROM "SeccionHabitualProducto" UNION ALL SELECT 'FrecuenciaConteoProducto', count(*) FROM "FrecuenciaConteoProducto";
