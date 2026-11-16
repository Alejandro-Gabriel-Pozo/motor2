-- Verificación de 20261115150000_presentacion_de_compra_por_producto (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: (1) cuántas presentaciones hay (la migración las conserva todas); (2) las que violarían un CHECK (factor <= 0, o unidad con nombre vacío o de más de 80): tiene que salir vacío;
-- (3) pares de presentaciones del mismo producto cuyas unidades se llaman igual sin distinguir mayúsculas (romperían el índice único nuevo): tiene que salir vacío.
-- DESPUÉS: las tres columnas nuevas, con el nombre rellenado (ninguna en NULL), el CHECK y el índice.
SELECT count(*) AS presentaciones FROM "Presentacion";
SELECT p."id", p."factorConversion", u."nombre" AS unidad FROM "Presentacion" p JOIN "Unidad" u ON u."empresaId" = p."empresaId" AND u."id" = p."unidadCompraId"
  WHERE p."factorConversion" <= 0 OR char_length(btrim(u."nombre")) NOT BETWEEN 1 AND 80 ORDER BY 1;
SELECT p."empresaId", p."productoId", lower(btrim(u."nombre")) AS nombre, count(*) AS repetidas FROM "Presentacion" p JOIN "Unidad" u ON u."empresaId" = p."empresaId" AND u."id" = p."unidadCompraId"
  GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 1, 2, 3;
SELECT column_name::text AS columna_nueva, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Presentacion' AND column_name IN ('nombre', 'pesoVariable', 'version') ORDER BY 1;
-- SOLO DESPUÉS de aplicar (antes la columna no existe): tiene que dar 0.
-- SELECT count(*) AS sin_nombre FROM "Presentacion" WHERE "nombre" IS NULL;
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = to_regclass('public."Presentacion"') AND contype IN ('c', 'u') ORDER BY 1;
SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Presentacion' ORDER BY 1;
