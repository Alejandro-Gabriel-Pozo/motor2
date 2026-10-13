-- Reversa de 20261020120000_go1c_opciones_por_sucursal (GO-1c). NO destructiva: ABORTA, sin tocar nada, si hay filas en PrecioLocalDeOpcion o en OpcionApagadaEnSucursal (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si están vacías (o no existen), las borra.
-- Bajar esta DESPUÉS de GO-1c-rls (sus políticas de sucursal dependen de las tablas) y ANTES que GO-1b (las opciones que referencian). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada);
-- después `npx prisma migrate resolve --rolled-back 20261020120000_go1c_opciones_por_sucursal`. Idempotente.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      hay := hay + n;
    END IF;
  END LOOP;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-1c: hay % fila(s) de precios locales o de opciones apagadas. Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DROP TABLE IF EXISTS "OpcionApagadaEnSucursal";
DROP TABLE IF EXISTS "PrecioLocalDeOpcion";
