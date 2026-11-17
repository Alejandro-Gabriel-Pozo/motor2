-- Reversa de 20261117180000_clase_de_uso_del_producto. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún producto ya tiene clase: sacar la columna la perdería en silencio. Antes, resguardar las
-- clases (se pueden rehacer con las reglas de rellenar del diseño de clases §6.4, pero no todas: Insumo y Reventa no se infieren):
--   SELECT "id", "empresaId", "claseDeUso" FROM "Producto" WHERE "claseDeUso" IS NOT NULL;
-- Con todo en NULL (o si la columna ya no existe), saca el disparador, la función, los tres CHECK y la columna con IF EXISTS. Idempotente.
-- Correr a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_con_clase bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'claseDeUso') THEN
    EXECUTE 'SELECT count(*) FROM "Producto" WHERE "claseDeUso" IS NOT NULL' INTO n_con_clase;
  END IF;
  IF n_con_clase > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117180000_clase_de_uso_del_producto: hay % producto(s) con clase de uso. Resguardalas (y decidí cómo conservarlas) antes de volver a correr este script.', n_con_clase
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "Producto_claseDeUso_inmutable_trg" ON "Producto";
DROP FUNCTION IF EXISTS producto_clase_de_uso_inmutable();
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_seProduce_chk";
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_tipo_chk";
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_chk";
ALTER TABLE "Producto" DROP COLUMN IF EXISTS "claseDeUso";
