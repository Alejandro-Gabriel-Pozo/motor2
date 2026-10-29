-- Reversa de 20261029120000_producto_admite_grupo_se_muestra_en_carta («Mostrar este grupo en la carta», 2026-10-29). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún producto tiene un
-- grupo apagado en la carta (`seMuestraEnCarta = false`): esa decisión del dueño no se borra en silencio. Primero se vuelve a tildar desde la pantalla del producto (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "productoId", "grupoId" FROM "ProductoAdmiteGrupo" WHERE NOT "seMuestraEnCarta";
-- Sin ninguno apagado (o si la columna ya no existe), saca el GRANT por columna y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA: con una que terminó bien da P3012):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261029120000_producto_admite_grupo_se_muestra_en_carta' AND rolled_back_at IS NULL;

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND column_name = 'seMuestraEnCarta') THEN
    EXECUTE 'SELECT count(*) FROM "ProductoAdmiteGrupo" WHERE NOT "seMuestraEnCarta"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261029120000_producto_admite_grupo_se_muestra_en_carta: hay % grupo(s) de producto apagados en la carta («Mostrar este grupo en la carta»). Volvelos a tildar desde la pantalla del producto (o resguardalos) y decidí antes cómo seguir.', n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
      REVOKE UPDATE ("seMuestraEnCarta") ON "ProductoAdmiteGrupo" FROM motor2_app;
    END IF;
  END IF;
END
$$;

ALTER TABLE "ProductoAdmiteGrupo" DROP COLUMN IF EXISTS "seMuestraEnCarta";
