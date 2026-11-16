-- Reversa de 20261115151000_presentacion_unico_de_unidad_a_indice: vuelve a hacer ÚNICO (producto, unidad). Si ya hay dos presentaciones del mismo producto con la misma unidad (lo que esta etapa permitía), SE FRENA con un error y no toca
-- NADA (ni índice ni datos): hay que resolver los duplicados a mano antes. Idempotente. Correr a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE duplicadas integer;
BEGIN
  SELECT count(*) INTO duplicadas FROM (SELECT 1 FROM "Presentacion" GROUP BY "productoId", "unidadCompraId" HAVING count(*) > 1) d;
  IF duplicadas > 0 THEN
    RAISE EXCEPTION 'down.sql frenado: hay % par(es) (producto, unidad) con más de una presentación; no se vuelve a hacer único. No se tocó nada.', duplicadas;
  END IF;
END
$$;

DROP INDEX IF EXISTS "Presentacion_productoId_unidadCompraId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "Presentacion_productoId_unidadCompraId_key" ON "Presentacion" ("productoId", "unidadCompraId");
