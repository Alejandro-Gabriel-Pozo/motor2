-- Reversa de 20261117114000_caja_c2_jornada (Caja y cobro, etapa C2). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117114000_caja_c2_jornada`.
-- Bajar ANTES 20261117115000_rls_sucursal_caja_c2 (sus políticas cuelgan de las tablas; DROP TABLE las arrastra, pero la reversa de esa migración es la que deja el registro limpio).
-- ABORTA si hay algo que decidió una persona y se perdería: una jornada EN_AUDITORIA o CERRADA, filas en las otras cuatro tablas nuevas, un movimiento AJUSTE o una hora de corte distinta de 00:00 (en una sucursal o en una sesión).
-- Las jornadas ABIERTAS no cuentan: se derivan de las sesiones y se vuelven a crear con la actividad. Con eso limpio el estado resultante es el de C1.
-- Bajarla dos veces no falla: si algo ya no está, no hay nada que contar ni que borrar.
DO $$
DECLARE
  t text;
  filas bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada'] LOOP
    filas := 0;
    IF to_regclass(format('%I', t)) IS NOT NULL THEN EXECUTE format('SELECT count(*) FROM %I', t) INTO filas; END IF;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117114000_caja_c2_jornada: la tabla % tiene % fila(s)', t, filas;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'MovimientoCaja' AND column_name = 'corrigeJornada') THEN
    EXECUTE 'SELECT count(*) FROM "MovimientoCaja" WHERE "clase" = ''AJUSTE''' INTO filas;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117114000_caja_c2_jornada: hay % movimiento(s) AJUSTE', filas;
    END IF;
  END IF;
  IF to_regclass('"JornadaDeSucursal"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "JornadaDeSucursal" WHERE "estado" <> ''ABIERTA''' INTO filas;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117114000_caja_c2_jornada: hay % jornada(s) en cierre o cerrada(s)', filas;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Sucursal' AND column_name = 'horaDeCorte') THEN
    EXECUTE 'SELECT count(*) FROM "Sucursal" WHERE "horaDeCorte" <> time ''00:00''' INTO filas;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117114000_caja_c2_jornada: % sucursal(es) tienen una hora de corte distinta de 00:00', filas;
    END IF;
    EXECUTE 'SELECT count(*) FROM "SesionCaja" WHERE "horaDeCorte" <> time ''00:00''' INTO filas;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117114000_caja_c2_jornada: % sesion(es) de caja se abrieron con una hora de corte distinta de 00:00', filas;
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS "ConformeDeJornada";
DROP TABLE IF EXISTS "DeclaracionDeTotal";
DROP TABLE IF EXISTS "CorreccionDeMedio";
DROP TABLE IF EXISTS "ControlDeJornadaCerrada";
DROP TABLE IF EXISTS "JornadaDeSucursal";
DROP FUNCTION IF EXISTS "ConformeDeJornada_validar"();
DROP FUNCTION IF EXISTS "DeclaracionDeTotal_validar"();
DROP FUNCTION IF EXISTS "CorreccionDeMedio_validar"();
DROP FUNCTION IF EXISTS "ControlDeJornadaCerrada_validar"();
DROP FUNCTION IF EXISTS "JornadaDeSucursal_exigir_estado"(text, uuid, text, text);
DROP FUNCTION IF EXISTS "JornadaDeSucursal_validar_cambio"();

-- Las reglas, tal como eran antes de C2 (SesionCaja_validar de C1; MovimientoCaja_validar de C3) (los disparadores `SesionCaja_validar_*` y `MovimientoCaja_validar` siguen apuntando a estas funciones por nombre).
CREATE OR REPLACE FUNCTION "SesionCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;

CREATE OR REPLACE FUNCTION "MovimientoCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo text; v_activo boolean; o record;
BEGIN
  PERFORM "SesionCaja_exigir_abierta"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  SELECT m."tipo", m."activo" INTO v_tipo, v_activo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDePagoId";
  IF NEW."clase" IN ('FONDO_INICIAL', 'INGRESO_MANUAL', 'EGRESO_MANUAL') AND v_tipo IS DISTINCT FROM 'EFECTIVO' THEN
    RAISE EXCEPTION 'movimiento_manual_solo_en_efectivo' USING ERRCODE = '23514';
  END IF;
  IF NEW."clase" = 'COBRO' AND v_activo IS NOT TRUE THEN RAISE EXCEPTION 'cobro_con_medio_inactivo' USING ERRCODE = '23514'; END IF;
  IF NEW."clase" = 'ANULACION' THEN
    SELECT a."clase", a."sesionId", a."medioDePagoId", a."importe", a."cuentaDeCobroId" INTO o FROM "MovimientoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."id" = NEW."anulaAId";
    IF o."clase" IS NULL OR o."clase" NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL') THEN RAISE EXCEPTION 'anulacion_de_movimiento_no_anulable' USING ERRCODE = '23514'; END IF;
    IF o."sesionId" <> NEW."sesionId" OR o."medioDePagoId" <> NEW."medioDePagoId" OR o."importe" <> -NEW."importe" OR o."cuentaDeCobroId" IS DISTINCT FROM NEW."cuentaDeCobroId" THEN RAISE EXCEPTION 'anulacion_no_es_el_espejo' USING ERRCODE = '23514'; END IF;
  ELSE
    PERFORM "CuentaDeCobro_validar_par"('movimiento_caja', NEW."empresaId", NEW."sucursalId", v_tipo, NEW."cuentaDeCobroId", true);
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "MovimientoCaja" DROP CONSTRAINT IF EXISTS "MovimientoCaja_corrige_chk";
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT IF EXISTS "MovimientoCaja_clase_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_clase_chk" CHECK ("clase" IN ('FONDO_INICIAL', 'COBRO', 'INGRESO_MANUAL', 'EGRESO_MANUAL', 'ANULACION'));
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT IF EXISTS "MovimientoCaja_signo_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_signo_chk" CHECK (
  ("clase" = 'FONDO_INICIAL' AND "importe" >= 0)
  OR ("clase" IN ('COBRO', 'INGRESO_MANUAL') AND "importe" > 0)
  OR ("clase" = 'EGRESO_MANUAL' AND "importe" < 0)
  OR ("clase" = 'ANULACION' AND "importe" <> 0));
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT IF EXISTS "MovimientoCaja_motivo_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_motivo_chk" CHECK (
  ("clase" IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'ANULACION') AND "motivo" IS NOT NULL AND char_length("motivo") BETWEEN 1 AND 500)
  OR ("clase" IN ('FONDO_INICIAL', 'COBRO') AND "motivo" IS NULL));
ALTER TABLE "MovimientoCaja" DROP COLUMN IF EXISTS "corrigeJornada";
ALTER TABLE "SesionCaja" DROP CONSTRAINT IF EXISTS "SesionCaja_horaDeCorte_chk";
ALTER TABLE "SesionCaja" DROP COLUMN IF EXISTS "horaDeCorte";
ALTER TABLE "Sucursal" DROP CONSTRAINT IF EXISTS "Sucursal_horaDeCorte_chk";
ALTER TABLE "Sucursal" DROP COLUMN IF EXISTS "horaDeCorte";
DROP FUNCTION IF EXISTS caja_fecha_de_negocio(timestamptz, text, time);
