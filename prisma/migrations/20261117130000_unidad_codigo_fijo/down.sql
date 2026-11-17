-- Reversa de 20261117130000_unidad_codigo_fijo. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna unidad ya tiene un código fijo asignado: esa equivalencia es un dato de la
-- empresa (la revisó el dueño, base por base) y no se borra en silencio. Primero decidir qué hacer con ellas (resguardarlas):
--   SELECT "id", "empresaId", "nombre", "codigoFijo" FROM "Unidad" WHERE "codigoFijo" IS NOT NULL;
-- Sin datos (o si la columna ya no existe), saca el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_unidades bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Unidad' AND column_name = 'codigoFijo') THEN
    EXECUTE 'SELECT count(*) FROM "Unidad" WHERE "codigoFijo" IS NOT NULL' INTO n_unidades;
  END IF;
  IF n_unidades > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117130000_unidad_codigo_fijo: hay % unidad(es) con un código fijo asignado. Resguardalas (y decidí cómo conservarlas) antes de volver a correr este script.', n_unidades USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE "Unidad" DROP CONSTRAINT IF EXISTS "Unidad_codigoFijo_chk";
ALTER TABLE "Unidad" DROP COLUMN IF EXISTS "codigoFijo";
