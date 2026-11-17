-- Verificación de 20261117180000_clase_de_uso_del_producto (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida (sin nombres de productos en el repositorio: solo conteos).
-- ANTES: la columna no existe (resultado vacío) y estas cuentas fijan el punto de partida. DESPUÉS: la columna existe (TEXT, nullable, sin valor por defecto), están los tres CHECK y el disparador, y NINGÚN producto tiene clase
-- (la migración no escribe nada).
SELECT column_name::text AS columna_nueva, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'claseDeUso';
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
  WHERE conrelid = '"Producto"'::regclass AND conname IN ('Producto_claseDeUso_chk', 'Producto_claseDeUso_tipo_chk', 'Producto_claseDeUso_seProduce_chk') ORDER BY 1;
SELECT tgname::text AS disparador FROM pg_trigger WHERE tgrelid = '"Producto"'::regclass AND tgname = 'Producto_claseDeUso_inmutable_trg' AND NOT tgisinternal;
-- Solo DESPUÉS (la columna recién existe): debe dar 0.
-- SELECT count(*) AS productos_con_clase FROM "Producto" WHERE "claseDeUso" IS NOT NULL;
-- En cualquier momento (tiene que dar los MISMOS números antes y después): productos por tipo y cuántos se producen.
SELECT "empresaId", "tipo"::text AS tipo, count(*) AS productos, count(*) FILTER (WHERE "seProduce") AS se_producen FROM "Producto" GROUP BY 1, 2 ORDER BY 1, 2;
