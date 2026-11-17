-- Caja y cobro, etapa C2b «La foto congelada de la conciliación por medio» (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md §7), como la decidió Pedernal (0027_caja.sql: cierre_de_caja_de_jornada, conciliacion_de_jornada y conciliacion_de_cobro_por_origen; e3b §4.4 y §4.6).
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon). Pedido del dueño (2026-11-16, P-FOTO): «También la conciliación por medio, como Pedernal».
--
-- QUÉ: TRES tablas nuevas, solo para agregar: `CierreDeCajaDeJornada` (la cabecera, una por jornada), `ConciliacionDeJornada` (una línea por medio) y `ConciliacionDeCobroPorOrigen` (las cobranzas del día cuyo cobrado difiere del total vigente de su ticket). No toca ninguna
-- fila, columna ni función existente: el código de C2 no las lee ni las escribe, así que se puede aplicar por adelantado. Índices sin CONCURRENTLY (tablas nuevas y vacías).
--
-- QUÉ DECIDE LA BASE (no depende de que el caso de uso se acuerde): la foto SOLO entra con la jornada pasando a CERRADA en la misma transacción (estado CERRADA y `xmin` de la transacción en curso: ni sembrarla con la jornada abierta ni agregarle líneas a una foto de antes);
-- el efectivo es siempre CONTADO y los demás medios nunca; el estado de conteo manda sobre el declarado y el conforme; al CONFIRMAR (disparador diferido de la cabecera) la foto se RECALCULA de los movimientos, las correcciones, las declaraciones, el conforme general y los arqueos de la jornada y tiene que ser
-- exactamente igual (una línea por cada medio con movimientos, correcciones o declaración; `caja_conciliacion_incompleta` / `caja_conciliacion_no_cuadra`), y el cobrado de cada origen es la suma real de sus cobros. La `diferencia` es una columna GENERADA: declarado − (registrado + correcciones) con CONTADO o DECLARADO (nula con CONFORME o SIN_DATO),
-- y cobrado − total del ticket en los orígenes. QUÉ DECIDE EL CASO DE USO: qué reconoció quien cierra (la explicación opcional) y el total vigente del ticket (de ventas: la base no lo puede verificar).
-- Molde (E-0): `id` UUID que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE, TRUNCATE ni UPDATE en ninguna (solo SELECT e INSERT); dinero NUMERIC(14,2). Las políticas de alcance de sucursal van en la migración siguiente (20261117117000), salida exacta del generador.
--
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117116000_caja_c2b_conciliacion`). Bajar ANTES la de políticas (20261117117000). La reversa ABORTA si hay filas en cualquiera de las tres tablas.

DO $$
BEGIN
  IF to_regclass('"JornadaDeSucursal"') IS NULL OR to_regclass('"ConformeDeJornada"') IS NULL OR to_regclass('"CorreccionDeMedio"') IS NULL OR to_regclass('"DeclaracionDeTotal"') IS NULL OR to_regclass('"ArqueoCaja"') IS NULL OR to_regclass('"Cobranza"') IS NULL THEN
    RAISE EXCEPTION 'caja C2b requiere 20261117114000_caja_c2_jornada aplicada antes' USING ERRCODE = '55000';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "CierreDeCajaDeJornada" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "jornadaId" UUID NOT NULL,
    "congeladoEn" TIMESTAMPTZ(3) NOT NULL,
    "congeladoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CierreDeCajaDeJornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciliacionDeJornada" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "cierreId" UUID NOT NULL,
    "medioDePagoId" UUID NOT NULL,
    "registrado" DECIMAL(14,2) NOT NULL,
    "correcciones" DECIMAL(14,2) NOT NULL,
    "declarado" DECIMAL(14,2),
    "estadoDeConteo" TEXT NOT NULL,
    "conformePorId" TEXT,
    "conformeEn" TIMESTAMPTZ(3),
    "diferencia" DECIMAL(14,2) GENERATED ALWAYS AS (CASE WHEN "estadoDeConteo" IN ('CONTADO', 'DECLARADO') THEN "declarado" - ("registrado" + "correcciones") END) STORED,
    "explicacion" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConciliacionDeJornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciliacionDeCobroPorOrigen" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "cierreId" UUID NOT NULL,
    "cobranzaId" UUID NOT NULL,
    "cobrado" DECIMAL(14,2) NOT NULL,
    "totalDelTicket" DECIMAL(14,2) NOT NULL,
    "diferencia" DECIMAL(14,2) GENERATED ALWAYS AS ("cobrado" - "totalDelTicket") STORED,
    "explicacion" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConciliacionDeCobroPorOrigen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CierreDeCajaDeJornada_empresaId_id_key" ON "CierreDeCajaDeJornada"("empresaId", "id");
CREATE UNIQUE INDEX "CierreDeCajaDeJornada_empresaId_jornadaId_key" ON "CierreDeCajaDeJornada"("empresaId", "jornadaId");
CREATE UNIQUE INDEX "ConciliacionDeJornada_empresaId_id_key" ON "ConciliacionDeJornada"("empresaId", "id");
CREATE UNIQUE INDEX "ConciliacionDeJornada_empresaId_cierreId_medioDePagoId_key" ON "ConciliacionDeJornada"("empresaId", "cierreId", "medioDePagoId");
CREATE UNIQUE INDEX "ConciliacionDeCobroPorOrigen_empresaId_id_key" ON "ConciliacionDeCobroPorOrigen"("empresaId", "id");
CREATE UNIQUE INDEX "ConciliacionDeCobroPorOrigen_empresaId_cierreId_cobranzaId_key" ON "ConciliacionDeCobroPorOrigen"("empresaId", "cierreId", "cobranzaId");

-- AddForeignKey
ALTER TABLE "CierreDeCajaDeJornada" ADD CONSTRAINT "CierreDeCajaDeJornada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CierreDeCajaDeJornada" ADD CONSTRAINT "CierreDeCajaDeJornada_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CierreDeCajaDeJornada" ADD CONSTRAINT "CierreDeCajaDeJornada_empresaId_jornadaId_fkey" FOREIGN KEY ("empresaId", "jornadaId") REFERENCES "JornadaDeSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CierreDeCajaDeJornada" ADD CONSTRAINT "CierreDeCajaDeJornada_congeladoPorId_fkey" FOREIGN KEY ("congeladoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_empresaId_cierreId_fkey" FOREIGN KEY ("empresaId", "cierreId") REFERENCES "CierreDeCajaDeJornada"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_empresaId_medioDePagoId_fkey" FOREIGN KEY ("empresaId", "medioDePagoId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_conformePorId_fkey" FOREIGN KEY ("conformePorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_empresaId_cierreId_fkey" FOREIGN KEY ("empresaId", "cierreId") REFERENCES "CierreDeCajaDeJornada"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_empresaId_cobranzaId_fkey" FOREIGN KEY ("empresaId", "cobranzaId") REFERENCES "Cobranza"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Reglas que Prisma no modela (a mano) =====

-- ConciliacionDeJornada: el estado manda sobre el declarado y el conforme (decisión 164 de Pedernal): CONTADO y DECLARADO llevan declarado y ningún conforme; CONFORME lleva quién y cuándo y ningún importe; SIN_DATO, nada.
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_estado_chk" CHECK ("estadoDeConteo" IN ('CONTADO', 'DECLARADO', 'CONFORME', 'SIN_DATO'));
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_datos_chk" CHECK (
  ("estadoDeConteo" IN ('CONTADO', 'DECLARADO') AND "declarado" IS NOT NULL AND "declarado" >= 0 AND "conformePorId" IS NULL AND "conformeEn" IS NULL)
  OR ("estadoDeConteo" = 'CONFORME' AND "declarado" IS NULL AND "conformePorId" IS NOT NULL AND "conformeEn" IS NOT NULL)
  OR ("estadoDeConteo" = 'SIN_DATO' AND "declarado" IS NULL AND "conformePorId" IS NULL AND "conformeEn" IS NULL));
ALTER TABLE "ConciliacionDeJornada" ADD CONSTRAINT "ConciliacionDeJornada_explicacion_chk" CHECK (
  "explicacion" IS NULL OR (
    "explicacion" = btrim("explicacion") AND char_length("explicacion") BETWEEN 1 AND 500
    AND "explicacion" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'));

-- ConciliacionDeCobroPorOrigen: solo los que difieren (cobrado distinto del total del ticket); el total del ticket no es negativo.
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_total_chk" CHECK ("totalDelTicket" >= 0);
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_difiere_chk" CHECK ("cobrado" <> "totalDelTicket");
ALTER TABLE "ConciliacionDeCobroPorOrigen" ADD CONSTRAINT "ConciliacionDeCobroPorOrigen_explicacion_chk" CHECK (
  "explicacion" IS NULL OR (
    "explicacion" = btrim("explicacion") AND char_length("explicacion") BETWEEN 1 AND 500
    AND "explicacion" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'));

-- ===== Disparadores =====

-- La cabecera solo entra con SU jornada (de la misma sucursal) pasando a CERRADA en ESTA transacción.
CREATE FUNCTION "CierreDeCajaDeJornada_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."id" = NEW."jornadaId" AND j."sucursalId" = NEW."sucursalId" AND j."estado" = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'foto_de_caja_solo_al_cerrar_la_jornada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CierreDeCajaDeJornada_validar" BEFORE INSERT ON "CierreDeCajaDeJornada" FOR EACH ROW EXECUTE FUNCTION "CierreDeCajaDeJornada_validar"();

-- Las líneas son de la cabecera de ESTA transacción (no se agregan líneas a una foto de antes) y de su sucursal. El efectivo es siempre CONTADO y los demás medios nunca.
CREATE FUNCTION "ConciliacionDeJornada_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CierreDeCajaDeJornada" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cierreId" AND c."sucursalId" = NEW."sucursalId" AND c.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'lineas_de_la_foto_solo_con_su_cabecera_en_la_misma_transaccion' USING ERRCODE = '23514';
  END IF;
  SELECT m."tipo" INTO v_tipo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDePagoId";
  IF (v_tipo = 'EFECTIVO') IS DISTINCT FROM (NEW."estadoDeConteo" = 'CONTADO') THEN
    RAISE EXCEPTION 'el_efectivo_es_siempre_contado_y_los_demas_medios_nunca' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConciliacionDeJornada_validar" BEFORE INSERT ON "ConciliacionDeJornada" FOR EACH ROW EXECUTE FUNCTION "ConciliacionDeJornada_validar"();

-- Los orígenes: de la cabecera de ESTA transacción y de su sucursal; la cobranza es de una sesión de la jornada que se cierra.
CREATE FUNCTION "ConciliacionDeCobroPorOrigen_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CierreDeCajaDeJornada" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cierreId" AND c."sucursalId" = NEW."sucursalId" AND c.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'lineas_de_la_foto_solo_con_su_cabecera_en_la_misma_transaccion' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Cobranza" b
      JOIN "SesionCaja" s ON s."empresaId" = b."empresaId" AND s."id" = b."sesionId"
      JOIN "CierreDeCajaDeJornada" c ON c."empresaId" = NEW."empresaId" AND c."id" = NEW."cierreId"
      JOIN "JornadaDeSucursal" j ON j."empresaId" = c."empresaId" AND j."id" = c."jornadaId"
     WHERE b."empresaId" = NEW."empresaId" AND b."id" = NEW."cobranzaId" AND s."sucursalId" = j."sucursalId" AND s."fechaDeNegocio" = j."fechaDeNegocio") THEN
    RAISE EXCEPTION 'la_cobranza_no_es_de_la_jornada_que_se_cierra' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConciliacionDeCobroPorOrigen_validar" BEFORE INSERT ON "ConciliacionDeCobroPorOrigen" FOR EACH ROW EXECUTE FUNCTION "ConciliacionDeCobroPorOrigen_validar"();

-- Al CONFIRMAR (DIFERIDO): la foto cuadra con lo que hay (e3b §4.4 y §4.6). Recalcula, por medio: lo registrado, las correcciones, el declarado y el estado de conteo, en este orden de prioridad: declaración vigente, conforme general de la jornada, lo derivado de los cierres de caja
-- de las sesiones, sin dato. Es el espejo EXACTO de `conciliarJornada` (src/core/caja/conciliacion.ts); una prueba recorre las combinaciones.
CREATE FUNCTION "CierreDeCajaDeJornada_verificar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_faltan bigint; v_difieren bigint;
BEGIN
  WITH jor AS (
    SELECT j."id", j."sucursalId", j."fechaDeNegocio" FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."id" = NEW."jornadaId"
  ), sesiones AS (
    SELECT s."id", s."cerradaEn", s."cerradaPorId" FROM "SesionCaja" s JOIN jor ON jor."sucursalId" = s."sucursalId" AND jor."fechaDeNegocio" = s."fechaDeNegocio" WHERE s."empresaId" = NEW."empresaId"
  ), registrado AS (
    SELECT m."medioDePagoId" AS medio, sum(m."importe") AS importe FROM "MovimientoCaja" m JOIN sesiones s ON s."id" = m."sesionId" WHERE m."empresaId" = NEW."empresaId" GROUP BY 1
  ), efectos AS (
    SELECT k."medioAntesId" AS medio, -r."importe" AS importe FROM "CorreccionDeMedio" k JOIN "Cobro" r ON r."empresaId" = k."empresaId" AND r."id" = k."cobroId" WHERE k."empresaId" = NEW."empresaId" AND k."jornadaId" = NEW."jornadaId"
    UNION ALL
    SELECT k."medioDespuesId", r."importe" FROM "CorreccionDeMedio" k JOIN "Cobro" r ON r."empresaId" = k."empresaId" AND r."id" = k."cobroId" WHERE k."empresaId" = NEW."empresaId" AND k."jornadaId" = NEW."jornadaId"
  ), correcciones AS (
    SELECT medio, sum(importe) AS importe FROM efectos GROUP BY 1
  ), declaraciones AS (
    SELECT DISTINCT ON (d."medioDePagoId") d."medioDePagoId" AS medio, d."importe" FROM "DeclaracionDeTotal" d WHERE d."empresaId" = NEW."empresaId" AND d."jornadaId" = NEW."jornadaId" ORDER BY d."medioDePagoId", d."secuencia" DESC
  ), conforme_general AS (
    SELECT g."conformePorId", g."conformeEn" FROM "ConformeDeJornada" g WHERE g."empresaId" = NEW."empresaId" AND g."jornadaId" = NEW."jornadaId"
  ), cierres AS (
    SELECT a."medioDePagoId" AS medio, count(*) AS lineas, count(*) FILTER (WHERE a."conforme") AS conformes, sum(a."contado") AS contado,
           (array_agg(s."cerradaPorId" ORDER BY s."cerradaEn" DESC, s."cerradaPorId" DESC) FILTER (WHERE a."conforme"))[1] AS conforme_por,
           max(s."cerradaEn") FILTER (WHERE a."conforme") AS conforme_en
      FROM "ArqueoCaja" a JOIN sesiones s ON s."id" = a."sesionId" WHERE a."empresaId" = NEW."empresaId" GROUP BY 1
  ), pares AS (
    SELECT medio FROM registrado UNION SELECT medio FROM correcciones UNION SELECT medio FROM declaraciones
  ), esperadas AS (
    SELECT p.medio, coalesce(r.importe, 0) AS registrado, coalesce(c.importe, 0) AS correcciones,
           CASE WHEN me."tipo" = 'EFECTIVO' THEN 'CONTADO'
                WHEN d.medio IS NOT NULL THEN 'DECLARADO'
                WHEN (SELECT count(*) FROM conforme_general) > 0 THEN 'CONFORME'
                WHEN ci.lineas > 0 AND ci.conformes = 0 THEN 'DECLARADO'
                WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN 'CONFORME'
                ELSE 'SIN_DATO' END AS estado,
           CASE WHEN me."tipo" = 'EFECTIVO' THEN coalesce(ci.contado, 0)
                WHEN d.medio IS NOT NULL THEN d.importe
                WHEN (SELECT count(*) FROM conforme_general) > 0 THEN NULL
                WHEN ci.lineas > 0 AND ci.conformes = 0 THEN ci.contado
                ELSE NULL END AS declarado,
           CASE WHEN me."tipo" = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
                WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g."conformePorId" FROM conforme_general g)
                WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_por END AS conforme_por,
           CASE WHEN me."tipo" = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
                WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g."conformeEn" FROM conforme_general g)
                WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_en END AS conforme_en
      FROM pares p
      JOIN "MedioDePago" me ON me."id" = p.medio AND me."empresaId" = NEW."empresaId"
      LEFT JOIN registrado r ON r.medio = p.medio
      LEFT JOIN correcciones c ON c.medio = p.medio
      LEFT JOIN declaraciones d ON d.medio = p.medio
      LEFT JOIN cierres ci ON ci.medio = p.medio
  ), guardadas AS (
    SELECT g.* FROM "ConciliacionDeJornada" g WHERE g."empresaId" = NEW."empresaId" AND g."cierreId" = NEW."id"
  )
  SELECT count(*) FILTER (WHERE e.medio IS NULL OR g."medioDePagoId" IS NULL),
         count(*) FILTER (WHERE e.medio IS NOT NULL AND g."medioDePagoId" IS NOT NULL AND (
                 g."registrado" <> e.registrado OR g."correcciones" <> e.correcciones OR g."declarado" IS DISTINCT FROM e.declarado
                 OR g."estadoDeConteo" <> e.estado OR g."conformePorId" IS DISTINCT FROM e.conforme_por OR g."conformeEn" IS DISTINCT FROM e.conforme_en))
    INTO v_faltan, v_difieren
    FROM esperadas e FULL JOIN guardadas g ON g."medioDePagoId" = e.medio;
  IF v_faltan > 0 THEN RAISE EXCEPTION 'caja_conciliacion_incompleta' USING ERRCODE = '23514'; END IF;
  IF v_difieren > 0 THEN RAISE EXCEPTION 'caja_conciliacion_no_cuadra' USING ERRCODE = '23514'; END IF;
  -- Cobrado contra el ticket: el `cobrado` de cada origen guardado es la suma real de los cobros de esa cobranza (el total del ticket es de ventas y no se puede verificar acá).
  IF EXISTS (
    SELECT 1 FROM "ConciliacionDeCobroPorOrigen" o
     WHERE o."empresaId" = NEW."empresaId" AND o."cierreId" = NEW."id"
       AND o."cobrado" IS DISTINCT FROM (SELECT coalesce(sum(co."importe"), 0) FROM "Cobro" co WHERE co."empresaId" = o."empresaId" AND co."cobranzaId" = o."cobranzaId")) THEN
    RAISE EXCEPTION 'caja_conciliacion_no_cuadra' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "CierreDeCajaDeJornada_verificar" AFTER INSERT ON "CierreDeCajaDeJornada" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "CierreDeCajaDeJornada_verificar"();

-- ===== RLS por empresa (las políticas por sucursal van en 20261117117000) =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CierreDeCajaDeJornada', 'ConciliacionDeJornada', 'ConciliacionDeCobroPorOrigen'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()))', t);
  END LOOP;
END
$$;

-- ===== Privilegios (si los roles existen): leer y agregar; NUNCA borrar ni editar. La consola de plataforma no las toca. =====
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "CierreDeCajaDeJornada" FROM motor2_app;
    GRANT SELECT, INSERT ON "CierreDeCajaDeJornada" TO motor2_app;
    REVOKE ALL ON "ConciliacionDeJornada" FROM motor2_app;
    GRANT SELECT, INSERT ON "ConciliacionDeJornada" TO motor2_app;
    REVOKE ALL ON "ConciliacionDeCobroPorOrigen" FROM motor2_app;
    GRANT SELECT, INSERT ON "ConciliacionDeCobroPorOrigen" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "CierreDeCajaDeJornada" FROM motor2_plataforma;
    REVOKE ALL ON "ConciliacionDeJornada" FROM motor2_plataforma;
    REVOKE ALL ON "ConciliacionDeCobroPorOrigen" FROM motor2_plataforma;
  END IF;
END
$$;
