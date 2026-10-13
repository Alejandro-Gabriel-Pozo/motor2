-- Reversa de 20261019100000_planes_y_centros_de_costos (Paquete 5, M7.1). NO destructiva: ABORTA, sin tocar nada, si ya hay planes, centros o filas de aplicabilidad (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si las tablas están vacías (o no existen), las borra.
-- Bajar esta DESPUÉS de M7.4, M7.3 y M7.2 (la distribución de costos tiene claves foráneas hacia los planes y los centros: con ella arriba, el `DROP TABLE` falla por dependencias, a propósito). Orden de la reversa de M7: M7.4, M7.3, M7.2, M7.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261019100000_planes_y_centros_de_costos`. Idempotente.

DO $$
DECLARE
  planes integer := 0;
  centros integer := 0;
  aplicabilidad integer := 0;
BEGIN
  IF to_regclass('"PlanDeCostos"') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM "PlanDeCostos"' INTO planes; END IF;
  IF to_regclass('"CentroDeCostos"') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM "CentroDeCostos"' INTO centros; END IF;
  IF to_regclass('"PlanDeCostosSucursal"') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM "PlanDeCostosSucursal"' INTO aplicabilidad; END IF;
  IF planes + centros + aplicabilidad > 0 THEN
    RAISE EXCEPTION 'No se puede bajar M7.1: hay % plan(es), % centro(s) y % fila(s) de aplicabilidad. Resguardalos (pg_dump -t ''"PlanDeCostos"'' -t ''"CentroDeCostos"'' -t ''"PlanDeCostosSucursal"'') y decidí antes cómo seguir.', planes, centros, aplicabilidad;
  END IF;
END
$$;

DROP TABLE IF EXISTS "PlanDeCostosSucursal";
DROP TABLE IF EXISTS "CentroDeCostos";
DROP TABLE IF EXISTS "PlanDeCostos";
