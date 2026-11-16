-- Verificación de 20261115151000_presentacion_unico_de_unidad_a_indice (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: el índice único existe; ningún par (producto, unidad) repetido (el único lo garantiza). DESPUÉS: el índice común existe y el único ya no; las presentaciones son las mismas.
SELECT count(*) AS presentaciones FROM "Presentacion";
SELECT indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Presentacion' ORDER BY 1;
SELECT "productoId", "unidadCompraId", count(*) AS repetidas FROM "Presentacion" GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2;
