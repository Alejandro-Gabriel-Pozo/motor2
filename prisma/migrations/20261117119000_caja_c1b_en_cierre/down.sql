-- Reversa de 20261117119000_caja_c1b_en_cierre (Caja y cobro, etapa C1b). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117119000_caja_c1b_en_cierre`.
-- Bajar ANTES que 20261117110000_caja_c1 y 20261117111000_rls_sucursal_caja_c1 (las tablas de C1 tienen que seguir existiendo para devolverles sus funciones y CHECK de C1).
-- ABORTA si hay sesiones EN_CIERRE (el esquema de C1 no las admite: habría que cancelar o terminar el cierre antes). Si hay sesiones cerradas con su cierre iniciado, las dos columnas se pierden (queda el registro de auditoría).
-- Idempotente: si `SesionCaja` ya no existe (bajó C1) no hay nada que deshacer y no deja funciones huérfanas.
DO $$
DECLARE
  filas bigint;
BEGIN
  IF to_regclass('"SesionCaja"') IS NOT NULL THEN
    SELECT count(*) INTO filas FROM "SesionCaja" WHERE "estado" = 'EN_CIERRE';
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117119000_caja_c1b_en_cierre: hay % sesion(es) de caja EN_CIERRE (cancelá o terminá el cierre primero)', filas;
    END IF;
  END IF;
END
$$;

-- Las funciones de C1 (cuerpos de 20261117110000_caja_c1), solo si la tabla existe.
DO $$
BEGIN
  IF to_regclass('"SesionCaja"') IS NOT NULL THEN
    EXECUTE $f$
CREATE OR REPLACE FUNCTION "Arqueo_validar"() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  PERFORM "SesionCaja_exigir_abierta"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  RETURN NEW;
END $g$
$f$;
    EXECUTE $f$
CREATE OR REPLACE FUNCTION "SesionCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $g$
DECLARE v_sucursal text; v_activa boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'ABIERTA' THEN RAISE EXCEPTION 'sesion_caja_nace_abierta' USING ERRCODE = '23514'; END IF;
    SELECT c."sucursalId" INTO v_sucursal FROM "Caja" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cajaId";
    IF v_sucursal IS DISTINCT FROM NEW."sucursalId" THEN RAISE EXCEPTION 'sesion_caja_de_otra_sucursal' USING ERRCODE = '23514'; END IF;
    SELECT s."activo" INTO v_activa FROM "Sucursal" s WHERE s."empresaId" = NEW."empresaId" AND s."id" = NEW."sucursalId";
    IF v_activa IS NOT TRUE THEN RAISE EXCEPTION 'sesion_caja_sucursal_inactiva' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."estado" = 'CERRADA' THEN RAISE EXCEPTION 'sesion_caja_cerrada_no_se_toca' USING ERRCODE = '23514'; END IF;
  IF NEW."estado" <> 'CERRADA' THEN RAISE EXCEPTION 'sesion_caja_solo_pasa_a_cerrada' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $g$
$f$;
  END IF;
END
$$;
DROP FUNCTION IF EXISTS "SesionCaja_exigir_en_cierre"(text, uuid, text);

-- Estados y marcas de C1 (las columnas nuevas se sacan antes de volver a poner el CHECK de C1, que no las nombra).
ALTER TABLE IF EXISTS "SesionCaja" DROP CONSTRAINT IF EXISTS "SesionCaja_marcas_chk";
ALTER TABLE IF EXISTS "SesionCaja" DROP CONSTRAINT IF EXISTS "SesionCaja_estado_chk";
ALTER TABLE IF EXISTS "SesionCaja" DROP COLUMN IF EXISTS "cierreIniciadoPorId";
ALTER TABLE IF EXISTS "SesionCaja" DROP COLUMN IF EXISTS "cierreIniciadoEn";
ALTER TABLE IF EXISTS "SesionCaja" ADD CONSTRAINT "SesionCaja_estado_chk" CHECK ("estado" IN ('ABIERTA', 'CERRADA'));
ALTER TABLE IF EXISTS "SesionCaja" ADD CONSTRAINT "SesionCaja_marcas_chk" CHECK (
  ("estado" = 'ABIERTA' AND "cerradaEn" IS NULL AND "cerradaPorId" IS NULL AND "observacion" IS NULL)
  OR ("estado" = 'CERRADA' AND "cerradaEn" IS NOT NULL AND "cerradaPorId" IS NOT NULL));
