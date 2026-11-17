-- Reversa de 20261117195000_reventa_clase_de_uso. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún producto ya es REVENTA: volver a la regla de E1 (un PV solo puede ser VENDIBLE) dejaría
-- esa fila violando el CHECK, o habría que cambiarle la clase (la clase no cambia una vez puesta). Antes, resguardar y decidir qué hacer con ellas:
--   SELECT "id", "empresaId", "nombre" FROM "Producto" WHERE "claseDeUso" = 'REVENTA';
-- Sin ninguna REVENTA (o si la columna ya no existe: la bajó el down de E1, que se lleva sus CHECK), saca el CHECK nuevo y deja "Producto_claseDeUso_tipo_chk" como lo dejó E1 (MP → MATERIA_PRIMA, INSUMO o
-- ELABORADO; PV → VENDIBLE). Idempotente.
-- Correr a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_reventa bigint := 0;
  hay_columna boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'claseDeUso') INTO hay_columna;
  IF hay_columna THEN
    EXECUTE 'SELECT count(*) FROM "Producto" WHERE "claseDeUso" = ''REVENTA''' INTO n_reventa;
  END IF;
  IF n_reventa > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117195000_reventa_clase_de_uso: hay % producto(s) con clase REVENTA. Resguardalos (y decidí cómo conservarlos) antes de volver a correr este script.', n_reventa
      USING ERRCODE = '55000';
  END IF;
  IF hay_columna THEN
    ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_reventa_chk";
    ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_tipo_chk";
    ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_tipo_chk"
      CHECK ("claseDeUso" IS NULL
        OR ("tipo" = 'MP' AND "claseDeUso" IN ('MATERIA_PRIMA', 'INSUMO', 'ELABORADO'))
        OR ("tipo" = 'PV' AND "claseDeUso" = 'VENDIBLE'));
  END IF;
END
$$;
