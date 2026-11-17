-- Verificación de 20261117130000_unidad_codigo_fijo (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: la columna no existe (resultado vacío). DESPUÉS: existe, es TEXT y acepta NULL; ninguna unidad tiene código fijo (la migración no rellena nada) y la cantidad de unidades es la misma.
SELECT table_name::text AS tabla, column_name::text AS columna_nueva, data_type, is_nullable
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Unidad' AND column_name = 'codigoFijo';
SELECT conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = to_regclass('public."Unidad"') AND conname = 'Unidad_codigoFijo_chk';
-- Solo DESPUÉS (la columna recién existe): debe dar 0.
-- SELECT count(*) AS unidades_con_codigo_fijo FROM "Unidad" WHERE "codigoFijo" IS NOT NULL;
-- En cualquier momento (tiene que dar el MISMO número antes y después): SELECT count(*) AS unidades FROM "Unidad";
