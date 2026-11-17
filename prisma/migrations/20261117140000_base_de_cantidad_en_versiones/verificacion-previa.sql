-- Verificación de 20261117140000_base_de_cantidad_en_versiones (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: las columnas no existen (resultado vacío). DESPUÉS: existen en las dos tablas, son TEXT NOT NULL con valor por defecto 'NETA' y su CHECK; ninguna versión es BRUTA (la migración no escribe nada).
SELECT table_name::text AS tabla, column_name::text AS columna_nueva, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('RecetaVersion', 'VersionDeOpcion') AND column_name = 'baseDeCantidad' ORDER BY 1;
SELECT conrelid::regclass::text AS tabla, conname::text, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
  WHERE conname IN ('RecetaVersion_baseDeCantidad_chk', 'VersionDeOpcion_baseDeCantidad_chk') ORDER BY 1;
-- Solo DESPUÉS (las columnas recién existen): las dos cuentas de BRUTA deben dar 0.
-- SELECT (SELECT count(*) FROM "RecetaVersion" WHERE "baseDeCantidad" = 'BRUTA') AS recetas_bruta, (SELECT count(*) FROM "VersionDeOpcion" WHERE "baseDeCantidad" = 'BRUTA') AS opciones_bruta;
-- En cualquier momento (tiene que dar los MISMOS números antes y después): SELECT (SELECT count(*) FROM "RecetaVersion") AS recetas, (SELECT count(*) FROM "VersionDeOpcion") AS opciones;
