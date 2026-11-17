-- Reversa de 20261117100000_planes_versionados (frente 4, M1). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117100000_planes_versionados/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117100000_planes_versionados`.
-- ABORTA, sin tocar nada, si la plataforma ya hizo algo a mano: más de un plan, más de una versión, una asignación que no sea la de transición, o una empresa con más de una asignación.
-- Si solo está la semilla de la migración, borra las 3 tablas y las funciones. Antes de bajarla con datos a mano, guardar
--   SELECT * FROM "Plan"; SELECT * FROM "VersionDePlan"; SELECT * FROM "PlanDeEmpresa";
-- IMPORTANTE: revertir el CÓDIGO de M1 antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  IF to_regclass('"PlanDeEmpresa"') IS NULL THEN
    RETURN;
  END IF;
  SELECT (SELECT count(*) FROM "Plan" WHERE "codigo" <> 'actual')
       + (SELECT count(*) FROM "VersionDePlan" WHERE "id" <> '00000000-0000-4000-8000-0000000a0003')
       + (SELECT count(*) FROM "PlanDeEmpresa" WHERE "origen" <> 'TRANSICION' OR "numero" <> 1)
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117100000_planes_versionados: hay % fila(s) de planes cargadas a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DROP TABLE IF EXISTS "PlanDeEmpresa";
DROP TABLE IF EXISTS "VersionDePlan";
DROP TABLE IF EXISTS "Plan";
DROP FUNCTION IF EXISTS reglas_de_plan_de_empresa();
DROP FUNCTION IF EXISTS reglas_de_version_de_plan();
DROP FUNCTION IF EXISTS reglas_de_plan();
DROP FUNCTION IF EXISTS proteger_tablas_de_planes();
