-- Caja y cobro, etapa C3: cuenta de cobro y marcas de tarjeta, COMO LAS DECIDIÓ PEDERNAL (docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- Pedido del dueño (2026-11-16): «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base».
--
-- QUÉ: DOS tablas nuevas (`CuentaDeCobro` y la lista global `ValorDeLista`, con sus semillas de marcas de tarjeta) y columnas NUEVAS Y OPCIONALES en cuatro tablas de C1:
--   MedioDePago  + pideCupon, pideUltimos4, pideMarca, pideCuotas, pideDni (todas false: «ningún dato extra pedido»; techo por tipo con CHECK)
--   MovimientoCaja + cuentaDeCobroId (NULL = «sin cuenta»)
--   Cobro        + cuentaDeCobroId, cupon, ultimos4, marcaDeTarjetaId, cuotas, dni (todas NULL)
--   ArqueoCaja   + cuentaDeCobroId (NULL = «sin cuenta»); el índice único pasa a (sesión, medio, cuenta) con NULLS NOT DISTINCT
-- Es ADITIVA: ninguna fila existente cambia de valor y el código de C1 sigue andando sin tocar las columnas nuevas (todas con default o NULL), así que el Instant Rollback de Vercel sigue siendo seguro.
-- Reemplaza tres funciones de C1 (MovimientoCaja_validar, Cobro_validar, SesionCaja_verificar_cierre) por versiones que también miran cuenta y datos; la reversa (down.sql) restaura las de C1 tal cual.
--
-- MOLDE (E-0): id UUID que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE ni TRUNCATE; UPDATE solo por columna donde hace falta. `ValorDeLista` es GLOBAL (sin empresaId, sin RLS): la app SOLO LEE
-- (REVOKE ALL + GRANT SELECT); quién la escribe (la consola de plataforma, que NO se construye acá) recibirá su GRANT cuando exista ese código (el guardián `grants-igual-a-uso` pide que todo grant tenga uso).
--
-- QUÉ DECIDE LA BASE: tipo de cuenta cerrado e inmutable; nombre de cuenta único por empresa sin mayúsculas; qué tipos de cuenta admite cada tipo de medio (`CuentaDeCobro_admitida_por_medio`); el efectivo no lleva cuenta;
-- la cuenta de un cobro es de la sucursal del movimiento, está activa y es compatible; qué datos puede pedir cada tipo de medio (`MedioDePago_datos_chk`); un dato que el medio no pidió se rechaza al guardar el cobro; la
-- marca es una marca de tarjeta ACTIVA; el arqueo se lleva por (medio, cuenta) y al cerrar cuadra contra los movimientos de cada par.
-- QUÉ DECIDE EL CASO DE USO: permisos, alcance de sucursal, forma de cada dato, huella del pedido, auditoría (solo qué datos se completaron, nunca sus valores).
-- Las políticas de alcance de sucursal de `CuentaDeCobro` van en la migración siguiente (20261117131000), salida exacta del generador.
--
-- Requiere PostgreSQL 15 o más (NULLS NOT DISTINCT; la base local y la de CI son 17) y soporte ICU para la collation de la lista. Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`;
-- después `prisma migrate resolve --rolled-back 20261117130000_caja_c3_cuenta_de_cobro`). Bajar ANTES la de políticas (20261117131000). La reversa ABORTA si se perdería algún dato.

-- ===== CuentaDeCobro =====
CREATE TABLE "CuentaDeCobro" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "identificadorExterno" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CuentaDeCobro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuentaDeCobro_empresaId_id_key" ON "CuentaDeCobro"("empresaId", "id");
CREATE UNIQUE INDEX "CuentaDeCobro_nombre_key" ON "CuentaDeCobro"("empresaId", lower("nombre"));

ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lista de permitidos (no de prohibidos): tipo cerrado, nombre de 1 a 60 sin blancos en los extremos, identificador (número de terminal o alias, NUNCA credenciales) de 1 a 40.
ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_tipo_chk" CHECK ("tipo" IN ('TERMINAL', 'QR', 'CUENTA_BANCARIA'));
ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_nombre_chk" CHECK ("nombre" = btrim("nombre") AND "nombre" ~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._/-]{0,59}$');
ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_identificador_chk" CHECK ("identificadorExterno" IS NULL OR ("identificadorExterno" = btrim("identificadorExterno") AND "identificadorExterno" ~ '^[A-Za-z0-9 ._/-]{1,40}$'));
ALTER TABLE "CuentaDeCobro" ADD CONSTRAINT "CuentaDeCobro_version_chk" CHECK ("version" >= 1);

-- El tipo (y la empresa y el alta) no cambian nunca.
CREATE FUNCTION "CuentaDeCobro_validar_cambio"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."empresaId" IS DISTINCT FROM OLD."empresaId" OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'cuenta_de_cobro_tipo_inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CuentaDeCobro_validar_cambio" BEFORE UPDATE ON "CuentaDeCobro" FOR EACH ROW EXECUTE FUNCTION "CuentaDeCobro_validar_cambio"();

-- ¿Admite este tipo de medio una cuenta de este tipo? (misma tabla que `CUENTAS_ADMITIDAS` de src/core/caja/medios.ts: una prueba las compara). El efectivo no admite ninguna.
CREATE FUNCTION "CuentaDeCobro_admitida_por_medio"(p_tipo_de_medio text, p_tipo_de_cuenta text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo_de_medio
    WHEN 'TARJETA_DEBITO' THEN p_tipo_de_cuenta = 'TERMINAL'
    WHEN 'TARJETA_CREDITO' THEN p_tipo_de_cuenta = 'TERMINAL'
    WHEN 'QR' THEN p_tipo_de_cuenta IN ('QR', 'TERMINAL')
    WHEN 'TRANSFERENCIA' THEN p_tipo_de_cuenta = 'CUENTA_BANCARIA'
    WHEN 'OTRO' THEN p_tipo_de_cuenta IN ('TERMINAL', 'QR', 'CUENTA_BANCARIA')
    ELSE false
  END
$$;

-- El par (medio, cuenta) de un movimiento o un arqueo: el efectivo no lleva cuenta; la cuenta existe en la empresa, es de la sucursal pedida, está activa (si se exige) y es de un tipo que el medio admite.
CREATE FUNCTION "CuentaDeCobro_validar_par"(p_tabla text, p_empresa text, p_sucursal text, p_tipo_de_medio text, p_cuenta uuid, p_exigir_activa boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  IF p_cuenta IS NULL THEN RETURN; END IF;
  IF p_tipo_de_medio = 'EFECTIVO' THEN RAISE EXCEPTION '%', p_tabla || '_cuenta_no_admitida' USING ERRCODE = '23514'; END IF;
  SELECT x."tipo", x."activa", x."sucursalId" INTO c FROM "CuentaDeCobro" x WHERE x."empresaId" = p_empresa AND x."id" = p_cuenta;
  IF c."tipo" IS NULL THEN RAISE EXCEPTION '%', p_tabla || '_cuenta_inexistente' USING ERRCODE = '23514'; END IF;
  IF c."sucursalId" <> p_sucursal THEN RAISE EXCEPTION '%', p_tabla || '_cuenta_de_otra_sucursal' USING ERRCODE = '23514'; END IF;
  IF p_exigir_activa AND NOT c."activa" THEN RAISE EXCEPTION '%', p_tabla || '_cuenta_inactiva' USING ERRCODE = '23514'; END IF;
  IF NOT "CuentaDeCobro_admitida_por_medio"(p_tipo_de_medio, c."tipo") THEN RAISE EXCEPTION '%', p_tabla || '_cuenta_incompatible' USING ERRCODE = '23514'; END IF;
END $$;

-- ===== ValorDeLista (GLOBAL: la administra la plataforma, la app solo lee) =====
-- Iguales si difieren solo en mayúsculas o acentos (ICU nivel 1, como Pedernal): no depende de LC_COLLATE.
CREATE COLLATION "valor_de_lista_nombre_ci" (provider = icu, locale = 'und-u-ks-level1', deterministic = false);

CREATE TABLE "ValorDeLista" (
    "id" UUID NOT NULL,
    "lista" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fija" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ValorDeLista_pkey" PRIMARY KEY ("id")
);

-- Una sola lista hoy (la de marcas de tarjeta); una lista nueva exige una migración nueva y un pedido del dueño.
ALTER TABLE "ValorDeLista" ADD CONSTRAINT "ValorDeLista_lista_chk" CHECK ("lista" IN ('MARCAS_DE_TARJETA'));
ALTER TABLE "ValorDeLista" ADD CONSTRAINT "ValorDeLista_nombre_chk" CHECK ("nombre" = btrim("nombre") AND "nombre" ~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._/-]{0,39}$');
ALTER TABLE "ValorDeLista" ADD CONSTRAINT "ValorDeLista_fija_chk" CHECK (NOT "fija" OR "activo");
ALTER TABLE "ValorDeLista" ADD CONSTRAINT "ValorDeLista_version_chk" CHECK ("version" >= 1);
CREATE UNIQUE INDEX "ValorDeLista_nombre_key" ON "ValorDeLista"("lista", "nombre" COLLATE "valor_de_lista_nombre_ci");
-- Una sola «Otra» (fija) por lista.
CREATE UNIQUE INDEX "ValorDeLista_fija_key" ON "ValorDeLista"("lista") WHERE "fija";

-- Semillas (los valores de ejemplo de Pedernal; el dueño no los confirmó: pregunta abierta). Los ids los genera la base solo acá.
INSERT INTO "ValorDeLista" ("id", "lista", "nombre", "fija") VALUES
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'Visa', false),
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'Mastercard', false),
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'American Express', false),
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'Cabal', false),
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'Naranja X', false),
  (gen_random_uuid(), 'MARCAS_DE_TARJETA', 'Otra', true);

CREATE FUNCTION "ValorDeLista_validar_cambio"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."lista" IS DISTINCT FROM OLD."lista" OR NEW."fija" IS DISTINCT FROM OLD."fija" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'valor_de_lista_inmutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."fija" AND (NEW."nombre" IS DISTINCT FROM OLD."nombre" OR NEW."activo" IS DISTINCT FROM OLD."activo") THEN
    RAISE EXCEPTION 'valor_de_lista_fija' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ValorDeLista_validar_cambio" BEFORE UPDATE ON "ValorDeLista" FOR EACH ROW EXECUTE FUNCTION "ValorDeLista_validar_cambio"();

-- ===== MedioDePago: qué datos pide al cobrar (todos nacen apagados) =====
ALTER TABLE "MedioDePago"
  ADD COLUMN "pideCupon" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pideUltimos4" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pideMarca" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pideCuotas" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pideDni" BOOLEAN NOT NULL DEFAULT false;
-- Techo por tipo: efectivo, QR y otro ninguno; débito cupón, últimos 4 y marca; crédito además cuotas; transferencia solo el DNI (src/core/caja/medios.ts, `DATOS_ADMITIDOS_POR_MEDIO`).
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_datos_chk" CHECK (
  ("tipo" IN ('EFECTIVO', 'QR', 'OTRO') AND NOT ("pideCupon" OR "pideUltimos4" OR "pideMarca" OR "pideCuotas" OR "pideDni"))
  OR ("tipo" = 'TARJETA_DEBITO' AND NOT ("pideCuotas" OR "pideDni"))
  OR ("tipo" = 'TARJETA_CREDITO' AND NOT "pideDni")
  OR ("tipo" = 'TRANSFERENCIA' AND NOT ("pideCupon" OR "pideUltimos4" OR "pideMarca" OR "pideCuotas")));

-- ===== MovimientoCaja, Cobro y ArqueoCaja: la cuenta de cobro (opcional) y los datos del cobro =====
ALTER TABLE "MovimientoCaja" ADD COLUMN "cuentaDeCobroId" UUID;
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_cuentaDeCobroId_fkey" FOREIGN KEY ("empresaId", "cuentaDeCobroId") REFERENCES "CuentaDeCobro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cobro"
  ADD COLUMN "cuentaDeCobroId" UUID,
  ADD COLUMN "cupon" TEXT,
  ADD COLUMN "ultimos4" CHAR(4),
  ADD COLUMN "marcaDeTarjetaId" UUID,
  ADD COLUMN "cuotas" SMALLINT,
  ADD COLUMN "dni" TEXT;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_cuentaDeCobroId_fkey" FOREIGN KEY ("empresaId", "cuentaDeCobroId") REFERENCES "CuentaDeCobro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_marcaDeTarjetaId_fkey" FOREIGN KEY ("marcaDeTarjetaId") REFERENCES "ValorDeLista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Nunca un número de tarjeta: ni 13 dígitos seguidos, ni 13 o más una vez quitados los separadores, ni solo separadores (como Pedernal).
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_cupon_chk" CHECK ("cupon" IS NULL OR ("cupon" ~ '^[A-Za-z0-9._/-]{1,32}$' AND "cupon" ~ '[A-Za-z0-9]' AND regexp_replace("cupon", '[._/-]', '', 'g') !~ '[0-9]{13}'));
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_ultimos4_chk" CHECK ("ultimos4" IS NULL OR "ultimos4" ~ '^[0-9]{4}$');
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_cuotas_chk" CHECK ("cuotas" IS NULL OR "cuotas" BETWEEN 1 AND 36);
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_dni_chk" CHECK ("dni" IS NULL OR "dni" ~ '^[0-9]{6,9}$');

ALTER TABLE "ArqueoCaja" ADD COLUMN "cuentaDeCobroId" UUID;
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_cuentaDeCobroId_fkey" FOREIGN KEY ("empresaId", "cuentaDeCobroId") REFERENCES "CuentaDeCobro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Una línea por (medio, cuenta); «sin cuenta» (NULL) es un grupo más y no se repite.
DROP INDEX "ArqueoCaja_empresaId_sesionId_medioDePagoId_key";
CREATE UNIQUE INDEX "ArqueoCaja_empresaId_sesionId_medioDePagoId_cuentaDeCobroId_key" ON "ArqueoCaja"("empresaId", "sesionId", "medioDePagoId", "cuentaDeCobroId") NULLS NOT DISTINCT;

-- ===== Funciones de C1 puestas al día (CREATE OR REPLACE: los disparadores ya existen) =====

-- MovimientoCaja: ahora también el par (medio, cuenta); una anulación es espejo también en la cuenta.
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

-- Cobro: su movimiento es de clase COBRO, del mismo medio, cuenta e importe; cada dato presente lo pidió el medio; la marca es una marca de tarjeta activa.
CREATE OR REPLACE FUNCTION "Cobro_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mv record; cb record; md record;
BEGIN
  SELECT x."clase", x."medioDePagoId", x."importe", x."sucursalId", x."sesionId", x."cuentaDeCobroId" INTO mv FROM "MovimientoCaja" x WHERE x."empresaId" = NEW."empresaId" AND x."id" = NEW."movimientoId";
  SELECT y."sucursalId", y."sesionId" INTO cb FROM "Cobranza" y WHERE y."empresaId" = NEW."empresaId" AND y."id" = NEW."cobranzaId";
  IF mv."clase" IS DISTINCT FROM 'COBRO' OR mv."medioDePagoId" <> NEW."medioDePagoId" OR mv."importe" <> NEW."importe" OR mv."cuentaDeCobroId" IS DISTINCT FROM NEW."cuentaDeCobroId" THEN RAISE EXCEPTION 'cobro_no_es_su_movimiento' USING ERRCODE = '23514'; END IF;
  IF mv."sucursalId" <> NEW."sucursalId" OR cb."sucursalId" <> NEW."sucursalId" OR mv."sesionId" <> cb."sesionId" THEN RAISE EXCEPTION 'cobro_de_otra_sucursal_o_sesion' USING ERRCODE = '23514'; END IF;
  SELECT d."pideCupon", d."pideUltimos4", d."pideMarca", d."pideCuotas", d."pideDni" INTO md FROM "MedioDePago" d WHERE d."empresaId" = NEW."empresaId" AND d."id" = NEW."medioDePagoId";
  IF (NEW."cupon" IS NOT NULL AND NOT md."pideCupon") OR (NEW."ultimos4" IS NOT NULL AND NOT md."pideUltimos4") OR (NEW."marcaDeTarjetaId" IS NOT NULL AND NOT md."pideMarca")
     OR (NEW."cuotas" IS NOT NULL AND NOT md."pideCuotas") OR (NEW."dni" IS NOT NULL AND NOT md."pideDni") THEN
    RAISE EXCEPTION 'cobro_dato_no_habilitado' USING ERRCODE = '23514';
  END IF;
  IF NEW."marcaDeTarjetaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ValorDeLista" v WHERE v."id" = NEW."marcaDeTarjetaId" AND v."lista" = 'MARCAS_DE_TARJETA' AND v."activo") THEN
    RAISE EXCEPTION 'cobro_marca_invalida' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ArqueoCaja: la línea de un par con cuenta es de un medio que admite cuenta (no el efectivo) y de una cuenta de la misma sucursal. (Aparte de Arqueo_validar: esa también la usa ArqueoBillete, que no tiene cuenta.)
CREATE FUNCTION "ArqueoCaja_validar_cuenta"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo text;
BEGIN
  IF NEW."cuentaDeCobroId" IS NULL THEN RETURN NEW; END IF;
  SELECT m."tipo" INTO v_tipo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDePagoId";
  PERFORM "CuentaDeCobro_validar_par"('arqueo_caja', NEW."empresaId", NEW."sucursalId", v_tipo, NEW."cuentaDeCobroId", false);
  RETURN NEW;
END $$;
CREATE TRIGGER "ArqueoCaja_validar_cuenta" BEFORE INSERT ON "ArqueoCaja" FOR EACH ROW EXECUTE FUNCTION "ArqueoCaja_validar_cuenta"();

-- Al CERRAR la sesión: lo mismo que C1, pero por (medio, cuenta): una línea por cada par con movimientos (y la del efectivo), cada esperado recalculado, ninguna línea sin movimientos.
CREATE OR REPLACE FUNCTION "SesionCaja_verificar_cierre"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_billetes numeric; v_hay_efectivo boolean;
BEGIN
  IF NEW."estado" <> 'CERRADA' THEN RETURN NULL; END IF;
  FOR r IN
    SELECT m."medioDePagoId", m."cuentaDeCobroId", sum(m."importe") AS esperado FROM "MovimientoCaja" m WHERE m."empresaId" = NEW."empresaId" AND m."sesionId" = NEW."id" GROUP BY m."medioDePagoId", m."cuentaDeCobroId"
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "ArqueoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id" AND a."medioDePagoId" = r."medioDePagoId" AND a."cuentaDeCobroId" IS NOT DISTINCT FROM r."cuentaDeCobroId" AND a."esperado" = r.esperado) THEN
      RAISE EXCEPTION 'cierre_arqueo_no_cuadra_con_los_movimientos' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "ArqueoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."sesionId" = NEW."id"
             AND NOT EXISTS (SELECT 1 FROM "MovimientoCaja" m WHERE m."empresaId" = a."empresaId" AND m."sesionId" = a."sesionId" AND m."medioDePagoId" = a."medioDePagoId" AND m."cuentaDeCobroId" IS NOT DISTINCT FROM a."cuentaDeCobroId")) THEN
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

-- ===== RLS por empresa de CuentaDeCobro (la de sucursal va en 20261117131000). `ValorDeLista` es GLOBAL: sin RLS. =====
ALTER TABLE "CuentaDeCobro" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CuentaDeCobro" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- ===== Privilegios (si los roles existen): leer y agregar; NUNCA borrar. UPDATE solo por columna donde hace falta. =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "CuentaDeCobro" FROM motor2_app;
    GRANT SELECT, INSERT ON "CuentaDeCobro" TO motor2_app;
    GRANT UPDATE ("nombre", "identificadorExterno", "sucursalId", "activa", "actualizadoEn", "version") ON "CuentaDeCobro" TO motor2_app;
    -- La lista global: la app SOLO LEE.
    REVOKE ALL ON "ValorDeLista" FROM motor2_app;
    GRANT SELECT ON "ValorDeLista" TO motor2_app;
    GRANT UPDATE ("pideCupon", "pideUltimos4", "pideMarca", "pideCuotas", "pideDni") ON "MedioDePago" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "CuentaDeCobro" FROM motor2_plataforma;
    REVOKE ALL ON "ValorDeLista" FROM motor2_plataforma;
  END IF;
END
$$;
