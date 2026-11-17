-- Reversa de 20261117100100_roles_propios_max (frente 4, P2). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117100100_roles_propios_max/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117100100_roles_propios_max`.
-- ABORTA, sin tocar nada, si la plataforma ya subió la perilla en alguna empresa (valor distinto de 0): bajarla perdería esa decisión. Antes de bajarla con valores cargados, guardar
--   SELECT "id", "slug", "rolesPropiosMax" FROM "Empresa" WHERE "rolesPropiosMax" <> 0;
-- IMPORTANTE: revertir el CÓDIGO de P2 antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Empresa' AND column_name = 'rolesPropiosMax') THEN
    EXECUTE 'SELECT count(*) FROM "Empresa" WHERE "rolesPropiosMax" <> 0' INTO hay;
    IF hay > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117100100_roles_propios_max: % empresa(s) tienen la perilla en un valor distinto de 0. Resguardalas y decidí antes cómo seguir.', hay;
    END IF;
  END IF;
END
$$;

ALTER TABLE "Empresa" DROP CONSTRAINT IF EXISTS "Empresa_rolesPropiosMax_check";
ALTER TABLE "Empresa" DROP COLUMN IF EXISTS "rolesPropiosMax";
