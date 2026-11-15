-- Reversa de 20261115100000_nombre_de_cocina. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún producto tiene nombre de cocina o alguna línea de cuenta lo tiene congelado: ese dato decide
-- cómo se reimprimen comandas ya enviadas y no se borra en silencio. Primero decidir qué hacer con ellos (resguardarlos):
--   SELECT "id", "empresaId", "nombre", "nombreDeCocina" FROM "Producto" WHERE "nombreDeCocina" IS NOT NULL;
--   SELECT "id", "cuentaId", "nombreDeCocina" FROM "CuentaItem" WHERE "nombreDeCocina" IS NOT NULL;
-- Sin datos (o si las columnas ya no existen), saca los CHECK y las columnas con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_productos bigint := 0;
  n_lineas bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'nombreDeCocina') THEN
    EXECUTE 'SELECT count(*) FROM "Producto" WHERE "nombreDeCocina" IS NOT NULL' INTO n_productos;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CuentaItem' AND column_name = 'nombreDeCocina') THEN
    EXECUTE 'SELECT count(*) FROM "CuentaItem" WHERE "nombreDeCocina" IS NOT NULL' INTO n_lineas;
  END IF;
  IF n_productos > 0 OR n_lineas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261115100000_nombre_de_cocina: hay % producto(s) con nombre de cocina y % línea(s) de cuenta con el nombre de cocina congelado. Resguardalos (y decidí cómo se reimprimen esas comandas) antes de seguir.', n_productos, n_lineas USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_nombre_de_cocina_chk";
ALTER TABLE "CuentaItem" DROP COLUMN IF EXISTS "nombreDeCocina";
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_nombre_de_cocina_chk";
ALTER TABLE "Producto" DROP COLUMN IF EXISTS "nombreDeCocina";
