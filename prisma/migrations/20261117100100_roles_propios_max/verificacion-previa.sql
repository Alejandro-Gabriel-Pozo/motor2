-- Verificación previa de 20261117100100_roles_propios_max (perilla de roles propios, P2). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración
-- (y de nuevo DESPUÉS, comparando):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117100100_roles_propios_max/verificacion-previa.sql
-- Devuelve SOLO cuentas (nunca nombres de empresa ni de rol). Cómo leerla:
--   1. «empresas_con_roles_propios_activos»: empresas que HOY tienen al menos un rol propio activo. Tras la migración conservan esos roles pero no pueden crear ni reactivar otros hasta que la plataforma
--      suba la perilla (queda en 0 para TODAS). Si alguna cifra te sorprende, hablalo antes de aplicar.
--   2. «roles_propios_activos»: cuántos roles propios activos hay en total (no se tocan).
--   3. «columna_ya_existe» tiene que dar 0 antes de aplicar.
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM "Empresa") AS empresas,
       (SELECT count(DISTINCT "empresaId") FROM "Rol" WHERE "clave" IS NULL AND "activo") AS empresas_con_roles_propios_activos,
       (SELECT count(*) FROM "Rol" WHERE "clave" IS NULL AND "activo") AS roles_propios_activos,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'Empresa' AND column_name = 'rolesPropiosMax') AS columna_ya_existe;

-- DESPUÉS de aplicar (descomentar): todas las empresas en 0 y ningún rol tocado.
-- SELECT count(*) FILTER (WHERE "rolesPropiosMax" = 0) AS empresas_en_cero, count(*) AS empresas FROM "Empresa";

ROLLBACK;
