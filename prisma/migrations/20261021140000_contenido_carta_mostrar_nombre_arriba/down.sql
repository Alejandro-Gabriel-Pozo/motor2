-- Reversa de 20261021140000_contenido_carta_mostrar_nombre_arriba (Fase 5, DEC-11). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún contenido de carta tiene «Mostrar el nombre
-- arriba» prendido: esa decisión no se borra en silencio. Primero se apaga desde la pantalla del contenido del producto (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "sucursalId", "productoId" FROM "ContenidoCartaProducto" WHERE "mostrarNombreArriba";
-- Sin ninguno prendido (o si la columna ya no existe), saca la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA: con una que terminó bien da P3012, verificado en la base local):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261021140000_contenido_carta_mostrar_nombre_arriba' AND rolled_back_at IS NULL;

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' AND column_name = 'mostrarNombreArriba') THEN
    EXECUTE 'SELECT count(*) FROM "ContenidoCartaProducto" WHERE "mostrarNombreArriba"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261021140000_contenido_carta_mostrar_nombre_arriba: hay % producto(s) con «Mostrar el nombre arriba» prendido en la carta. Apagalos desde la pantalla del contenido (o resguardalos) y decidí antes cómo seguir.', n;
    END IF;
  END IF;
END
$$;

ALTER TABLE "ContenidoCartaProducto" DROP COLUMN IF EXISTS "mostrarNombreArriba";
