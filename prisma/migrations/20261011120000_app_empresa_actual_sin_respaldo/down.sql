-- Reversa de 20261011120000_app_empresa_actual_sin_respaldo: devuelve el cuerpo EXACTO de la migración 20260929100000_multiempresa_estructura (paso 3), con su respaldo
-- «la única empresa ACTIVE». Como dueño, a mano. Después: `prisma migrate resolve --rolled-back 20261011120000_app_empresa_actual_sin_respaldo`.
CREATE OR REPLACE FUNCTION app_empresa_actual() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.empresa_id', true), ''),
    (SELECT CASE WHEN count(*) = 1 THEN min("id") END FROM public."Empresa" WHERE "estado" = 'ACTIVE')
  )
$$;

COMMENT ON FUNCTION app_empresa_actual() IS NULL;
