-- Reversa de 20261115140000_parte_ficha_unica_p1 (Parte, etapa P1). A mano, como dueño (evade RLS), con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261115140000_parte_ficha_unica_p1`.
-- Quita la columna "Proveedor"."parteId" (con su FK y su único), la tabla "Parte" y las tres funciones. NO toca ninguna columna vieja de "Proveedor": el código anterior sigue andando porque nunca dejó de leerlas.
-- SE NIEGA si hay fichas que NO vienen de la migración ("migradaDe" IS NULL: altas hechas desde la app) o fichas migradas que ya se completaron o editaron (versión > 1): se perderían datos cargados a mano.
-- Con aviso previo al dueño y respaldo, se confirma así dentro de la misma transacción:  BEGIN; SET LOCAL motor2.confirmar_reversion = 'SI'; \i down.sql  COMMIT;
-- Antes de decidir, mirar:  SELECT count(*) FILTER (WHERE "migradaDe" IS NULL) AS altas_nuevas, count(*) FILTER (WHERE "version" > 1) AS editadas FROM "Parte";
-- IMPORTANTE: revertir el CÓDIGO de P1 antes (o a la vez). Sin CASCADE: si otra tabla (de una etapa posterior) ya apunta a "Parte", el DROP falla y no se pierde nada. Idempotente (si ya está bajada, no falla).
DO $$
DECLARE
  v_nuevas bigint := 0;
  v_editadas bigint := 0;
BEGIN
  IF to_regclass('public."Parte"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) AND NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public."Parte"'::regclass AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
      RAISE EXCEPTION 'la reversión se corre como dueño de la tabla (o superusuario): con otro rol el conteo no vería todas las filas' USING ERRCODE = '55000';
    END IF;
    SELECT count(*) FILTER (WHERE "migradaDe" IS NULL), count(*) FILTER (WHERE "migradaDe" IS NOT NULL AND "version" > 1) INTO v_nuevas, v_editadas FROM "Parte";
    IF (v_nuevas > 0 OR v_editadas > 0) AND coalesce(current_setting('motor2.confirmar_reversion', true), '') <> 'SI' THEN
      RAISE EXCEPTION 'No se puede bajar 20261115140000_parte_ficha_unica_p1: hay % ficha(s) nueva(s) y % ficha(s) migrada(s) editada(s); avisar al dueño, tener un respaldo y repetir con SET LOCAL motor2.confirmar_reversion = ''SI''', v_nuevas, v_editadas USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

ALTER TABLE "Proveedor" DROP COLUMN IF EXISTS "parteId";
DROP TABLE IF EXISTS "Parte";
DROP FUNCTION IF EXISTS "Parte_proteger"();
DROP FUNCTION IF EXISTS texto_de_ficha_valido(text, integer);
DROP FUNCTION IF EXISTS cuit_valido(text);
