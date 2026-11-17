-- Reversa de 20261117140000_base_de_cantidad_en_versiones. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si ya existe alguna versión BRUTA (de receta o de opción):
-- sin la marca, esas versiones pasarían a leerse como NETA y se descontaría y costearía de menos. Antes: volver el código a M3a o anterior y resguardar/decidir qué hacer con ellas:
--   SELECT 'RecetaVersion' AS tabla, "id", "empresaId" FROM "RecetaVersion" WHERE "baseDeCantidad" = 'BRUTA'
--   UNION ALL SELECT 'VersionDeOpcion', "id", "empresaId" FROM "VersionDeOpcion" WHERE "baseDeCantidad" = 'BRUTA';
-- Con todo en NETA (o si las columnas ya no existen), saca los CHECK y las columnas con IF EXISTS. Idempotente.
-- Correr a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_recetas bigint := 0;
  n_opciones bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'RecetaVersion' AND column_name = 'baseDeCantidad') THEN
    EXECUTE 'SELECT count(*) FROM "RecetaVersion" WHERE "baseDeCantidad" = ''BRUTA''' INTO n_recetas;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'VersionDeOpcion' AND column_name = 'baseDeCantidad') THEN
    EXECUTE 'SELECT count(*) FROM "VersionDeOpcion" WHERE "baseDeCantidad" = ''BRUTA''' INTO n_opciones;
  END IF;
  IF n_recetas + n_opciones > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117140000_base_de_cantidad_en_versiones: hay % versión(es) de receta y % versión(es) de opción en base BRUTA. Resguardalas (y decidí cómo conservarlas) antes de volver a correr este script.', n_recetas, n_opciones
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE "RecetaVersion" DROP CONSTRAINT IF EXISTS "RecetaVersion_baseDeCantidad_chk";
ALTER TABLE "RecetaVersion" DROP COLUMN IF EXISTS "baseDeCantidad";
ALTER TABLE "VersionDeOpcion" DROP CONSTRAINT IF EXISTS "VersionDeOpcion_baseDeCantidad_chk";
ALTER TABLE "VersionDeOpcion" DROP COLUMN IF EXISTS "baseDeCantidad";
