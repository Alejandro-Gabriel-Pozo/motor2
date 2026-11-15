-- Verificación de 20261115100000_nombre_de_cocina (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: las dos columnas no existen (resultado vacío). DESPUÉS: las dos existen, son TEXT y aceptan NULL; ningún producto ni línea tiene nombre de cocina (la migración no rellena nada) y los dos CHECK están.
SELECT table_name::text AS tabla, column_name::text AS columna_nueva, data_type, is_nullable
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Producto', 'CuentaItem') AND column_name = 'nombreDeCocina' ORDER BY 1;
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
  WHERE conrelid IN (to_regclass('public."Producto"'), to_regclass('public."CuentaItem"')) AND conname IN ('Producto_nombre_de_cocina_chk', 'CuentaItem_nombre_de_cocina_chk') ORDER BY 1;
-- Solo DESPUÉS (la columna recién existe): ambos conteos deben dar 0.
-- SELECT count(*) AS productos_con_nombre_de_cocina FROM "Producto" WHERE "nombreDeCocina" IS NOT NULL;
-- SELECT count(*) AS lineas_con_nombre_de_cocina FROM "CuentaItem" WHERE "nombreDeCocina" IS NOT NULL;
