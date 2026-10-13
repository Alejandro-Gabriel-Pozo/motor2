-- Reversa de 20261020110000_go1b_grupos_y_opciones (GO-1b). NO destructiva: ABORTA, sin tocar nada, si hay filas en cualquiera de las seis tablas del catálogo de opciones (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si están vacías (o no existen), las borra.
-- Bajar esta DESPUÉS de GO-1c-rls, GO-1c, GO-1d-rls y GO-1d (la foto de la línea y los precios por sucursal tienen claves foráneas hacia el catálogo: con ellas arriba, el `DROP TABLE` falla por dependencias, a propósito).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261020110000_go1b_grupos_y_opciones`. Idempotente.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      hay := hay + n;
    END IF;
  END LOOP;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-1b: hay % fila(s) en el catálogo de opciones. Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DROP TABLE IF EXISTS "ProductoAdmiteOpcion";
DROP TABLE IF EXISTS "ProductoAdmiteGrupo";
DROP TABLE IF EXISTS "ConsumoDeOpcion";
DROP TABLE IF EXISTS "VersionDeOpcion";
DROP TABLE IF EXISTS "OpcionDeGrupo";
DROP TABLE IF EXISTS "GrupoDeOpciones";
