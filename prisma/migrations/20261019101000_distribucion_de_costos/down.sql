-- Reversa de 20261019101000_distribucion_de_costos (Paquete 5, M7.2). NO destructiva: ABORTA, sin tocar nada, si ya hay versiones o líneas de distribución (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si las tablas están vacías (o no existen), las borra.
-- Bajar esta DESPUÉS de M7.4 y M7.3 y ANTES que M7.1 (las políticas de alcance por sucursal dependen de estas tablas). Orden de la reversa de M7: M7.4, M7.3, M7.2, M7.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261019101000_distribucion_de_costos`. Idempotente.

DO $$
DECLARE
  versiones integer := 0;
  lineas integer := 0;
BEGIN
  IF to_regclass('"DistribucionCostoVersion"') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM "DistribucionCostoVersion"' INTO versiones; END IF;
  IF to_regclass('"DistribucionCostoLinea"') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM "DistribucionCostoLinea"' INTO lineas; END IF;
  IF versiones + lineas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar M7.2: hay % versión(es) y % línea(s) de distribución. Resguardalas (pg_dump -t ''"DistribucionCostoVersion"'' -t ''"DistribucionCostoLinea"'') y decidí antes cómo seguir.', versiones, lineas;
  END IF;
END
$$;

DROP TABLE IF EXISTS "DistribucionCostoLinea";
DROP TABLE IF EXISTS "DistribucionCostoVersion";
