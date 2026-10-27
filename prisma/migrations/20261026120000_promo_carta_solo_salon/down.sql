-- Reversa de 20261026120000_promo_carta_solo_salon (interruptor «solo salón» de las promociones). NO destructiva y FALLA CERRADA: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna promo tiene «solo salón»
-- prendido: bajar la columna haría PÚBLICAS esas promos (con su precio pactado) en cuanto vuelva el código viejo, que no conoce el interruptor. Primero se apaga desde Parametrización › Promociones (queda auditado)
-- o se resguarda:
--   SELECT "id", "empresaId", "titulo" FROM "PromoCarta" WHERE "soloSalon";
-- Sin ninguna prendida (o si la columna ya no existe), saca la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA: con una que terminó bien da P3012, verificado en la base local):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261026120000_promo_carta_solo_salon' AND rolled_back_at IS NULL;

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCarta' AND column_name = 'soloSalon') THEN
    EXECUTE 'SELECT count(*) FROM "PromoCarta" WHERE "soloSalon"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261026120000_promo_carta_solo_salon: hay % promo(s) con «solo salón» prendido. Bajarla las haría públicas en la carta al volver el código viejo. Apagalas desde Parametrización › Promociones (o resguardalas) y decidí antes cómo seguir.', n;
    END IF;
  END IF;
END
$$;

ALTER TABLE "PromoCarta" DROP COLUMN IF EXISTS "soloSalon";
