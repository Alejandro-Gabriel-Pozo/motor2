-- Reversa de 20261105120000_promo_entrada_a_elegir. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna entrada de promo es `A_ELEGIR`: sin la columna esa entrada se leería como una configuración FIJA con
-- las opciones permitidas (otra promo, otro precio por unidad), y no se transforma en silencio. Primero decidir qué hacer con ellas (resguardarlas y darlas de baja):
--   SELECT "id", "cupoId", "productoId", "activa" FROM "EntradaDeCupo" WHERE "modoDeOpciones" = 'A_ELEGIR';
-- Sin datos (o si la columna ya no existe), saca el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_a_elegir bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'EntradaDeCupo' AND column_name = 'modoDeOpciones') THEN
    EXECUTE 'SELECT count(*) FROM "EntradaDeCupo" WHERE "modoDeOpciones" = ''A_ELEGIR''' INTO n_a_elegir;
  END IF;
  IF n_a_elegir > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261105120000_promo_entrada_a_elegir: hay % entrada(s) de promo «a elegir». Resguardalas y dalas de baja antes de seguir.', n_a_elegir;
  END IF;
END
$$;

ALTER TABLE "EntradaDeCupo" DROP CONSTRAINT IF EXISTS "EntradaDeCupo_modo_de_opciones_chk";
ALTER TABLE "EntradaDeCupo" DROP COLUMN IF EXISTS "modoDeOpciones";
