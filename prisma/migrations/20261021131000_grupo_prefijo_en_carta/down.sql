-- Reversa de 20261021131000_grupo_prefijo_en_carta (Fase 4, C2). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún grupo tiene un prefijo cargado («se lee en la carta como»):
-- ese texto no se borra en silencio. Primero se vacía desde la pantalla del grupo (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "nombre", "prefijoEnCarta" FROM "GrupoDeOpciones" WHERE "prefijoEnCarta" IS NOT NULL;
-- Sin prefijos (o si la columna ya no existe), saca el GRANT por columna, el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'GrupoDeOpciones' AND column_name = 'prefijoEnCarta') THEN
    EXECUTE 'SELECT count(*) FROM "GrupoDeOpciones" WHERE "prefijoEnCarta" IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261021131000_grupo_prefijo_en_carta: hay % grupo(s) con «se lee en la carta como» cargado. Vacialos desde la pantalla del grupo (o resguardalos) y decidí antes cómo seguir.', n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
      REVOKE UPDATE ("prefijoEnCarta") ON "GrupoDeOpciones" FROM motor2_app;
    END IF;
  END IF;
END
$$;

ALTER TABLE "GrupoDeOpciones" DROP CONSTRAINT IF EXISTS "GrupoDeOpciones_prefijo_en_carta_chk";
ALTER TABLE "GrupoDeOpciones" DROP COLUMN IF EXISTS "prefijoEnCarta";
