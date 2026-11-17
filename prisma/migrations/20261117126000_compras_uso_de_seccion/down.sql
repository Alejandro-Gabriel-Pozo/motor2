-- Reversa de 20261117126000_compras_uso_de_seccion (Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i)). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna sección ya tiene un uso distinto de NORMAL
-- (es un dato de la empresa: dónde entró la mercadería rechazada o con observaciones; no se pierde en silencio). Primero decidir qué hacer con esas secciones (resguardarlas):
--   SELECT "id", "empresaId", "sucursalId", "nombre", "uso" FROM "Seccion" WHERE "uso" <> 'NORMAL';
-- Sin datos (o si la columna ya no existe), saca el disparador, la función, el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_secciones bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Seccion' AND column_name = 'uso') THEN
    EXECUTE 'SELECT count(*) FROM "Seccion" WHERE "uso" <> ''NORMAL''' INTO n_secciones;
  END IF;
  IF n_secciones > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117126000_compras_uso_de_seccion: hay % depósito(s) con un uso distinto de NORMAL. Resguardalos (y decidí cómo conservarlos) antes de volver a correr este script.', n_secciones USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "Seccion_uso_inmutable_chk" ON "Seccion";
DROP FUNCTION IF EXISTS "Seccion_uso_inmutable"();
ALTER TABLE "Seccion" DROP CONSTRAINT IF EXISTS "Seccion_uso_chk";
ALTER TABLE "Seccion" DROP COLUMN IF EXISTS "uso";
