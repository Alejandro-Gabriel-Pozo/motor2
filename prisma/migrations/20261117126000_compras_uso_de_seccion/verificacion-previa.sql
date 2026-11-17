-- Verificación previa de 20261117126000_compras_uso_de_seccion (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: la columna no existe (existe = false). DESPUÉS: existe, con su CHECK y su disparador, y TODAS las secciones quedan NORMAL (distintas_de_normal = 0).
BEGIN READ ONLY;

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Seccion' AND column_name = 'uso') AS existe;
SELECT count(*) AS check_y_disparador FROM (
  SELECT conname FROM pg_constraint WHERE conrelid = 'public."Seccion"'::regclass AND conname = 'Seccion_uso_chk'
  UNION ALL SELECT tgname FROM pg_trigger WHERE tgrelid = 'public."Seccion"'::regclass AND tgname = 'Seccion_uso_inmutable_chk' AND NOT tgisinternal
) t;
-- Solo después de aplicar (antes la columna no existe y esta consulta falla): SELECT "uso", count(*) FROM "Seccion" GROUP BY 1 ORDER BY 1;
SELECT count(*) AS secciones FROM "Seccion";

ROLLBACK;
