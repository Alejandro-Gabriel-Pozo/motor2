-- Reversa de 20261117130000_caja_c3_cuenta_de_cobro (Caja y cobro, etapa C3). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117130000_caja_c3_cuenta_de_cobro`.
-- Bajar ANTES 20261117131000_rls_sucursal_caja_c3 (sus políticas cuelgan de CuentaDeCobro).
-- ABORTA si se perdería algún dato: cuentas de cobro cargadas; movimientos, cobros o arqueos con cuenta; cobros con cupón, últimos 4, marca, cuotas o DNI; medios que piden algún dato; o una lista de marcas distinta de sus
-- semillas. Con todo eso vacío el estado resultante es el de C1. Bajarla dos veces no falla (todo es condicional a que exista).
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('"CuentaDeCobro"') IS NOT NULL THEN
    SELECT count(*) INTO n FROM "CuentaDeCobro";
    IF n > 0 THEN RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: CuentaDeCobro tiene % fila(s)', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'MovimientoCaja' AND column_name = 'cuentaDeCobroId') THEN
    SELECT count(*) INTO n FROM "MovimientoCaja" WHERE "cuentaDeCobroId" IS NOT NULL;
    IF n > 0 THEN RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: % movimiento(s) con cuenta de cobro', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ArqueoCaja' AND column_name = 'cuentaDeCobroId') THEN
    SELECT count(*) INTO n FROM "ArqueoCaja" WHERE "cuentaDeCobroId" IS NOT NULL;
    IF n > 0 THEN RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: % arqueo(s) con cuenta de cobro', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Cobro' AND column_name = 'cupon') THEN
    SELECT count(*) INTO n FROM "Cobro" WHERE "cuentaDeCobroId" IS NOT NULL OR "cupon" IS NOT NULL OR "ultimos4" IS NOT NULL OR "marcaDeTarjetaId" IS NOT NULL OR "cuotas" IS NOT NULL OR "dni" IS NOT NULL;
    IF n > 0 THEN RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: % cobro(s) con cuenta o datos', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'MedioDePago' AND column_name = 'pideCupon') THEN
    SELECT count(*) INTO n FROM "MedioDePago" WHERE "pideCupon" OR "pideUltimos4" OR "pideMarca" OR "pideCuotas" OR "pideDni";
    IF n > 0 THEN RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: % medio(s) piden datos', n; END IF;
  END IF;
  IF to_regclass('"ValorDeLista"') IS NOT NULL THEN
    SELECT count(*) INTO n FROM "ValorDeLista";
    IF n <> 6 OR EXISTS (SELECT 1 FROM "ValorDeLista" WHERE "version" > 1 OR NOT "activo" OR "nombre" NOT IN ('Visa', 'Mastercard', 'American Express', 'Cabal', 'Naranja X', 'Otra')) THEN
      RAISE EXCEPTION 'No se puede bajar 20261117130000_caja_c3_cuenta_de_cobro: la lista de marcas ya no es la sembrada';
    END IF;
  END IF;
END
$$;

-- Funciones de C1 (tal cual estaban en 20261117110000_caja_c1).
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
    SELECT a."clase", a."sesionId", a."medioDePagoId", a."importe" INTO o FROM "MovimientoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."id" = NEW."anulaAId";
    IF o."clase" IS NULL OR o."clase" NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL') THEN RAISE EXCEPTION 'anulacion_de_movimiento_no_anulable' USING ERRCODE = '23514'; END IF;
    IF o."sesionId" <> NEW."sesionId" OR o."medioDePagoId" <> NEW."medioDePagoId" OR o."importe" <> -NEW."importe" THEN RAISE EXCEPTION 'anulacion_no_es_el_espejo' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "Cobro_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mv record; cb record;
BEGIN
  SELECT x."clase", x."medioDePagoId", x."importe", x."sucursalId", x."sesionId" INTO mv FROM "MovimientoCaja" x WHERE x."empresaId" = NEW."empresaId" AND x."id" = NEW."movimientoId";
  SELECT y."sucursalId", y."sesionId" INTO cb FROM "Cobranza" y WHERE y."empresaId" = NEW."empresaId" AND y."id" = NEW."cobranzaId";
  IF mv."clase" IS DISTINCT FROM 'COBRO' OR mv."medioDePagoId" <> NEW."medioDePagoId" OR mv."importe" <> NEW."importe" THEN RAISE EXCEPTION 'cobro_no_es_su_movimiento' USING ERRCODE = '23514'; END IF;
  IF mv."sucursalId" <> NEW."sucursalId" OR cb."sucursalId" <> NEW."sucursalId" OR mv."sesionId" <> cb."sesionId" THEN RAISE EXCEPTION 'cobro_de_otra_sucursal_o_sesion' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "SesionCaja_verificar_cierre"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_billetes numeric; v_hay_efectivo boolean;
BEGIN
  IF NEW."estado" <> 'CERRADA' THEN RETURN NULL; END IF;
  FOR r IN
    SELECT m."medioDePagoId", sum(m."importe") AS esperado FROM "MovimientoCaja" m WHERE m."empresaId" = NEW."empresaId" AND m."sesionId" = NEW."id" GROUP BY m."medioDePagoId"
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "ArqueoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id" AND a."medioDePagoId" = r."medioDePagoId" AND a."esperado" = r.esperado) THEN
      RAISE EXCEPTION 'cierre_arqueo_no_cuadra_con_los_movimientos' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "ArqueoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id"
             AND NOT EXISTS (SELECT 1 FROM "MovimientoCaja" m WHERE m."empresaId" = a."empresaId" AND m."sesionId" = a."sesionId" AND m."medioDePagoId" = a."medioDePagoId")) THEN
    RAISE EXCEPTION 'cierre_arqueo_de_medio_sin_movimientos' USING ERRCODE = '23514';
  END IF;
  SELECT true INTO v_hay_efectivo FROM "ArqueoCaja" a JOIN "MedioDePago" p ON p."empresaId" = a."empresaId" AND p."id" = a."medioDePagoId"
   WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id" AND p."tipo" = 'EFECTIVO' AND NOT a."conforme" LIMIT 1;
  IF v_hay_efectivo IS NOT TRUE THEN RAISE EXCEPTION 'cierre_sin_efectivo_contado' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(sum(b."denominacion"::numeric * b."cantidad"), 0) INTO v_billetes FROM "ArqueoBillete" b WHERE b."empresaId" = NEW."empresaId" AND b."sesionId" = NEW."id";
  IF EXISTS (SELECT 1 FROM "ArqueoCaja" a JOIN "MedioDePago" p ON p."empresaId" = a."empresaId" AND p."id" = a."medioDePagoId"
              WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id" AND p."tipo" = 'EFECTIVO' AND a."contado" <> v_billetes + COALESCE(a."contadoMonedas", 0)) THEN
    RAISE EXCEPTION 'cierre_billetes_y_monedas_no_dan_lo_contado' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "ArqueoCaja" a JOIN "MedioDePago" p ON p."empresaId" = a."empresaId" AND p."id" = a."medioDePagoId"
              WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id" AND p."tipo" <> 'EFECTIVO' AND NOT a."conforme") THEN
    RAISE EXCEPTION 'cierre_medio_no_efectivo_sin_conforme' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS "ArqueoCaja_validar_cuenta" ON "ArqueoCaja";
DROP FUNCTION IF EXISTS "ArqueoCaja_validar_cuenta"();

-- Columnas y restricciones nuevas (los índices y claves foráneas que dependen de ellas caen con la columna).
DROP INDEX IF EXISTS "ArqueoCaja_empresaId_sesionId_medioDePagoId_cuentaDeCobroId_key";
ALTER TABLE "ArqueoCaja" DROP COLUMN IF EXISTS "cuentaDeCobroId";
CREATE UNIQUE INDEX IF NOT EXISTS "ArqueoCaja_empresaId_sesionId_medioDePagoId_key" ON "ArqueoCaja"("empresaId", "sesionId", "medioDePagoId");
ALTER TABLE "Cobro" DROP COLUMN IF EXISTS "cuentaDeCobroId", DROP COLUMN IF EXISTS "cupon", DROP COLUMN IF EXISTS "ultimos4", DROP COLUMN IF EXISTS "marcaDeTarjetaId", DROP COLUMN IF EXISTS "cuotas", DROP COLUMN IF EXISTS "dni";
ALTER TABLE "MovimientoCaja" DROP COLUMN IF EXISTS "cuentaDeCobroId";
ALTER TABLE "MedioDePago" DROP CONSTRAINT IF EXISTS "MedioDePago_datos_chk";
ALTER TABLE "MedioDePago" DROP COLUMN IF EXISTS "pideCupon", DROP COLUMN IF EXISTS "pideUltimos4", DROP COLUMN IF EXISTS "pideMarca", DROP COLUMN IF EXISTS "pideCuotas", DROP COLUMN IF EXISTS "pideDni";

DROP TABLE IF EXISTS "ValorDeLista";
DROP FUNCTION IF EXISTS "ValorDeLista_validar_cambio"();
DROP COLLATION IF EXISTS "valor_de_lista_nombre_ci";
DROP TABLE IF EXISTS "CuentaDeCobro";
DROP FUNCTION IF EXISTS "CuentaDeCobro_validar_cambio"();
DROP FUNCTION IF EXISTS "CuentaDeCobro_validar_par"(text, text, text, text, uuid, boolean);
DROP FUNCTION IF EXISTS "CuentaDeCobro_admitida_por_medio"(text, text);
