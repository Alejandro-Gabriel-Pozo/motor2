-- Zona horaria de la empresa validada por la BASE (paridad con Pedernal: `zona_horaria_valida` + `empresa_validar_zona_horaria`, migraciones/0001_base.sql; frente 3, etapa E-2:
-- `docs/diseno-datos-paridad-pedernal-2026-11-16.md`). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
--
-- QUÉ: una función `zona_horaria_valida(text)` (verdadera solo si el nombre está en `pg_timezone_names`) y un disparador en `Empresa` que rechaza (23514) un INSERT o un cambio de `zonaHoraria` con
-- una zona que Postgres no conoce. NO cambia columnas, ni datos, ni el valor por defecto (la consola ya prellena America/Argentina/Buenos_Aires). Compatible hacia atrás: el código anterior
-- siempre mandó una zona real; si mandara una inventada, ahora la base la frena (antes la guardaba y rompía el cálculo de la fecha de negocio).
--
-- GUARDA: si hoy hay una empresa con una zona que Postgres no reconoce, la migración ABORTA entera (una sola transacción, nada a medias) y nombra las empresas: se corrigen a mano antes de volver a aplicar.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117170000_empresa_zona_horaria_valida`).

DO $$
DECLARE
  v_malas text;
BEGIN
  SELECT string_agg(e."id" || ' (' || coalesce(e."zonaHoraria", 'NULL') || ')', ', ' ORDER BY e."id") INTO v_malas
    FROM "Empresa" e
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = e."zonaHoraria");
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'hay empresas con zona horaria que Postgres no reconoce: %', v_malas USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION zona_horaria_valida(z text) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT z IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = z)
$$;

CREATE OR REPLACE FUNCTION empresa_validar_zona_horaria() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.zona_horaria_valida(NEW."zonaHoraria") THEN
    RAISE EXCEPTION 'zona horaria inválida' USING ERRCODE = '23514', CONSTRAINT = 'Empresa_zonaHoraria_chk';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "Empresa_zona_horaria_valida" ON "Empresa";
CREATE TRIGGER "Empresa_zona_horaria_valida"
  BEFORE INSERT OR UPDATE OF "zonaHoraria" ON "Empresa"
  FOR EACH ROW EXECUTE FUNCTION empresa_validar_zona_horaria();
