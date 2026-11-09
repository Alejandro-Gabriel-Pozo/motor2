-- Reversa de 20261104130000_contenido_carta_nombre_en_carta («Nombre en la carta»). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún contenido de carta tiene un nombre cargado:
-- ese texto no se borra en silencio. Primero se vacía desde la pantalla del producto (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "sucursalId", "productoId", "nombreEnCarta" FROM "ContenidoCartaProducto" WHERE "nombreEnCarta" IS NOT NULL;
-- Sin nombres (o si la columna ya no existe), saca el índice único, el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' AND column_name = 'nombreEnCarta') THEN
    EXECUTE 'SELECT count(*) FROM "ContenidoCartaProducto" WHERE "nombreEnCarta" IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261104130000_contenido_carta_nombre_en_carta: hay % contenido(s) de carta con «Nombre en la carta» cargado. Vacialos desde la pantalla del producto (o resguardalos) y decidí antes cómo seguir.', n;
    END IF;
  END IF;
END
$$;

DROP INDEX IF EXISTS "ContenidoCartaProducto_sucursal_nombre_en_carta_key";
ALTER TABLE "ContenidoCartaProducto" DROP CONSTRAINT IF EXISTS "ContenidoCartaProducto_nombre_en_carta_chk";
ALTER TABLE "ContenidoCartaProducto" DROP COLUMN IF EXISTS "nombreEnCarta";
