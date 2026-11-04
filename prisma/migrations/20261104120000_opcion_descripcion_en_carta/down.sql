-- Reversa de 20261104120000_opcion_descripcion_en_carta (carta «B», E3). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna opción tiene una descripción cargada:
-- ese texto no se borra en silencio. Primero se vacía desde la pantalla de la opción (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "grupoId", "nombre", "descripcionEnCarta" FROM "OpcionDeGrupo" WHERE "descripcionEnCarta" IS NOT NULL;
-- Sin descripciones (o si la columna ya no existe), saca el GRANT por columna, el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OpcionDeGrupo' AND column_name = 'descripcionEnCarta') THEN
    EXECUTE 'SELECT count(*) FROM "OpcionDeGrupo" WHERE "descripcionEnCarta" IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261104120000_opcion_descripcion_en_carta: hay % opción(es) con descripción cargada. Vaciálas desde la pantalla de la opción (o resguardalas) y decidí antes cómo seguir.', n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
      REVOKE UPDATE ("descripcionEnCarta") ON "OpcionDeGrupo" FROM motor2_app;
    END IF;
  END IF;
END
$$;

ALTER TABLE "OpcionDeGrupo" DROP CONSTRAINT IF EXISTS "OpcionDeGrupo_descripcion_en_carta_chk";
ALTER TABLE "OpcionDeGrupo" DROP COLUMN IF EXISTS "descripcionEnCarta";
