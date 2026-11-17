-- Verificación de 20261117195000_reventa_clase_de_uso (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida (sin nombres de productos en el repositorio: solo conteos).
-- ANTES: tienen que existir la columna "claseDeUso" y los tres CHECK de E1 (20261117180000); "Producto_claseDeUso_reventa_chk" NO existe todavía; y NINGÚN producto es REVENTA (debe dar 0).
-- DESPUÉS: "Producto_claseDeUso_tipo_chk" admite además PV → REVENTA, existe "Producto_claseDeUso_reventa_chk", y los conteos de abajo dan los MISMOS números (la migración no escribe nada).
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
  WHERE conrelid = '"Producto"'::regclass AND conname IN ('Producto_claseDeUso_chk', 'Producto_claseDeUso_tipo_chk', 'Producto_claseDeUso_seProduce_chk', 'Producto_claseDeUso_reventa_chk') ORDER BY 1;
SELECT count(*) AS productos_reventa FROM "Producto" WHERE "claseDeUso" = 'REVENTA'; -- debe dar 0 antes y después (nada la escribe todavía)
-- En cualquier momento (tiene que dar los MISMOS números antes y después): productos por tipo, por clase y cuántos se producen.
SELECT "empresaId", "tipo"::text AS tipo, "claseDeUso", count(*) AS productos, count(*) FILTER (WHERE "seProduce") AS se_producen FROM "Producto" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
