-- Caja y cobro, etapa C1 (docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md, niveles 4 a 7). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar). Etapa C1 ratificada el 2026-11-16: «Caja: primera etapa (abrir caja, cobrar, arqueo)».
--
-- QUÉ: OCHO tablas nuevas: `Caja`, `MedioDePago`, `SesionCaja`, `MovimientoCaja`, `Cobranza`, `Cobro`, `ArqueoCaja`, `ArqueoBillete`. No toca ninguna fila ni columna existentes: el código anterior no las lee ni las escribe, así que se puede aplicar por
-- adelantado y el Instant Rollback de Vercel sigue siendo seguro. Índices sin CONCURRENTLY (tablas nuevas y vacías).
--
-- MOLDE (docs/diseno-datos-paridad-pedernal-2026-11-16.md, E-0): `id` UUID nativo que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE ni TRUNCATE en ninguna; historial que solo agrega (UPDATE solo por columna y solo
-- donde hace falta: `MedioDePago` y el cierre de `SesionCaja`); clave de reintento en los comandos que crean filas. Dinero NUMERIC(14,2) en pesos (confirmado por el dueño el 2026-11-16: «El de Motor2 hoy»).
--
-- QUÉ DECIDE LA BASE (no depende de que el caso de uso se acuerde): una caja por sucursal (C1); un solo medio EFECTIVO por empresa que no se desactiva; a lo sumo UNA sesión sin cerrar por caja; la sesión solo pasa de ABIERTA a CERRADA, una vez;
-- el signo de cada movimiento según su clase; un solo FONDO_INICIAL por sesión; una anulación es el espejo exacto de lo que anula y se hace una sola vez; una cuenta se cobra UNA vez; la suma de los renglones de un cobro es el total
-- congelado de la cobranza al centavo (disparador diferido); no se mueve dinero en una sesión cerrada ni en la de otra sucursal; al cerrar, el arqueo cuadra con lo movido (esperado recalculado, billetes + monedas = contado).
-- QUÉ DECIDE EL CASO DE USO: permisos, que la cuenta esté cerrada y su total, el vuelto (solo de pantalla), la auditoría y la clave de reintento.
-- Las políticas de alcance de sucursal (RLS por sucursal) van en la migración siguiente (20261117111000), salida exacta del generador.
--
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117110000_caja_c1`). Bajar ANTES la de políticas (20261117111000).
-- La reversa ABORTA si hay filas en cualquiera de las tablas (se perderían movimientos de dinero).

-- CreateTable
CREATE TABLE "Caja" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedioDePago" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "tipo" TEXT NOT NULL,
    "nombre" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MedioDePago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionCaja" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "cajaId" UUID NOT NULL,
    "estado" TEXT NOT NULL,
    "fechaDeNegocio" DATE NOT NULL,
    "zonaHoraria" TEXT NOT NULL,
    "abiertaEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abiertaPorId" TEXT NOT NULL,
    "cerradaEn" TIMESTAMPTZ(3),
    "cerradaPorId" TEXT,
    "observacion" TEXT,
    "claveIdempotencia" TEXT NOT NULL,
    "huella" TEXT NOT NULL,

    CONSTRAINT "SesionCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "sesionId" UUID NOT NULL,
    "clase" TEXT NOT NULL,
    "medioDePagoId" UUID NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "motivo" TEXT,
    "anulaAId" UUID,
    "claveIdempotencia" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" TEXT NOT NULL,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cobranza" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "sesionId" UUID NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" TEXT NOT NULL,

    CONSTRAINT "Cobranza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cobro" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "cobranzaId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "medioDePagoId" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Cobro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArqueoCaja" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "sesionId" UUID NOT NULL,
    "medioDePagoId" UUID NOT NULL,
    "esperado" DECIMAL(14,2) NOT NULL,
    "contado" DECIMAL(14,2),
    "contadoMonedas" DECIMAL(14,2),
    "conforme" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ArqueoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArqueoBillete" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "sesionId" UUID NOT NULL,
    "denominacion" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "ArqueoBillete_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Caja_empresaId_id_key" ON "Caja"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Caja_una_por_sucursal_key" ON "Caja"("empresaId", "sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "MedioDePago_empresaId_id_key" ON "MedioDePago"("empresaId", "id");

-- CreateIndex
CREATE INDEX "SesionCaja_cajaId_idx" ON "SesionCaja"("cajaId");

-- CreateIndex
CREATE UNIQUE INDEX "SesionCaja_empresaId_id_key" ON "SesionCaja"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SesionCaja_empresaId_claveIdempotencia_key" ON "SesionCaja"("empresaId", "claveIdempotencia");

-- CreateIndex
CREATE INDEX "MovimientoCaja_sesionId_idx" ON "MovimientoCaja"("sesionId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_empresaId_id_key" ON "MovimientoCaja"("empresaId", "id");

-- CreateIndex
CREATE INDEX "Cobranza_sesionId_idx" ON "Cobranza"("sesionId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranza_empresaId_id_key" ON "Cobranza"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranza_empresaId_cuentaId_key" ON "Cobranza"("empresaId", "cuentaId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranza_empresaId_claveIdempotencia_key" ON "Cobranza"("empresaId", "claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "Cobro_empresaId_id_key" ON "Cobro"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Cobro_empresaId_cobranzaId_orden_key" ON "Cobro"("empresaId", "cobranzaId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "Cobro_empresaId_movimientoId_key" ON "Cobro"("empresaId", "movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "ArqueoCaja_empresaId_id_key" ON "ArqueoCaja"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArqueoCaja_empresaId_sesionId_medioDePagoId_key" ON "ArqueoCaja"("empresaId", "sesionId", "medioDePagoId");

-- CreateIndex
CREATE UNIQUE INDEX "ArqueoBillete_empresaId_id_key" ON "ArqueoBillete"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArqueoBillete_empresaId_sesionId_denominacion_key" ON "ArqueoBillete"("empresaId", "sesionId", "denominacion");

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_empresaId_cajaId_fkey" FOREIGN KEY ("empresaId", "cajaId") REFERENCES "Caja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_sesionId_fkey" FOREIGN KEY ("empresaId", "sesionId") REFERENCES "SesionCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_medioDePagoId_fkey" FOREIGN KEY ("empresaId", "medioDePagoId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_empresaId_anulaAId_fkey" FOREIGN KEY ("empresaId", "anulaAId") REFERENCES "MovimientoCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_empresaId_sesionId_fkey" FOREIGN KEY ("empresaId", "sesionId") REFERENCES "SesionCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_cobranzaId_fkey" FOREIGN KEY ("empresaId", "cobranzaId") REFERENCES "Cobranza"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_medioDePagoId_fkey" FOREIGN KEY ("empresaId", "medioDePagoId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_empresaId_movimientoId_fkey" FOREIGN KEY ("empresaId", "movimientoId") REFERENCES "MovimientoCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_sesionId_fkey" FOREIGN KEY ("empresaId", "sesionId") REFERENCES "SesionCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_medioDePagoId_fkey" FOREIGN KEY ("empresaId", "medioDePagoId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoBillete" ADD CONSTRAINT "ArqueoBillete_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoBillete" ADD CONSTRAINT "ArqueoBillete_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoBillete" ADD CONSTRAINT "ArqueoBillete_empresaId_sesionId_fkey" FOREIGN KEY ("empresaId", "sesionId") REFERENCES "SesionCaja"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Reglas que Prisma no modela (a mano) =====

-- Caja: una por sucursal en C1 (índice `Caja_una_por_sucursal_key`, arriba). Nombre de lista permitida.
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_nombre_chk" CHECK ("nombre" ~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._/-]{0,99}$');

-- MedioDePago: tipo cerrado; el efectivo es único y no se desactiva; nombre de lista permitida y único sin mayúsculas.
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_tipo_chk" CHECK ("tipo" IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO'));
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_efectivo_activo_chk" CHECK ("tipo" <> 'EFECTIVO' OR "activo");
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_nombre_chk" CHECK ("nombre" IS NULL OR "nombre" ~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._/-]{0,59}$');
ALTER TABLE "MedioDePago" ADD CONSTRAINT "MedioDePago_version_chk" CHECK ("version" >= 1);
CREATE UNIQUE INDEX "MedioDePago_efectivo_key" ON "MedioDePago"("empresaId") WHERE "tipo" = 'EFECTIVO';
CREATE UNIQUE INDEX "MedioDePago_nombre_key" ON "MedioDePago"("empresaId", lower("nombre")) WHERE "nombre" IS NOT NULL;
-- Sin nombre propio, un medio por tipo (el tipo es su nombre).
CREATE UNIQUE INDEX "MedioDePago_sin_nombre_key" ON "MedioDePago"("empresaId", "tipo") WHERE "nombre" IS NULL;

-- SesionCaja
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_estado_chk" CHECK ("estado" IN ('ABIERTA', 'CERRADA'));
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_marcas_chk" CHECK (
  ("estado" = 'ABIERTA' AND "cerradaEn" IS NULL AND "cerradaPorId" IS NULL AND "observacion" IS NULL)
  OR ("estado" = 'CERRADA' AND "cerradaEn" IS NOT NULL AND "cerradaPorId" IS NOT NULL));
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_observacion_chk" CHECK ("observacion" IS NULL OR char_length("observacion") BETWEEN 1 AND 500);
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_clave_chk" CHECK ("claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_huella_chk" CHECK ("huella" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_zona_chk" CHECK (char_length("zonaHoraria") BETWEEN 1 AND 64);
CREATE UNIQUE INDEX "SesionCaja_una_sin_cerrar_por_caja_key" ON "SesionCaja"("empresaId", "cajaId") WHERE "estado" <> 'CERRADA';

-- MovimientoCaja
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_clase_chk" CHECK ("clase" IN ('FONDO_INICIAL', 'COBRO', 'INGRESO_MANUAL', 'EGRESO_MANUAL', 'ANULACION'));
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_signo_chk" CHECK (
  ("clase" = 'FONDO_INICIAL' AND "importe" >= 0)
  OR ("clase" IN ('COBRO', 'INGRESO_MANUAL') AND "importe" > 0)
  OR ("clase" = 'EGRESO_MANUAL' AND "importe" < 0)
  OR ("clase" = 'ANULACION' AND "importe" <> 0));
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_motivo_chk" CHECK (
  ("clase" IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'ANULACION') AND "motivo" IS NOT NULL AND char_length("motivo") BETWEEN 1 AND 500)
  OR ("clase" IN ('FONDO_INICIAL', 'COBRO') AND "motivo" IS NULL));
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_anula_chk" CHECK (("clase" = 'ANULACION') = ("anulaAId" IS NOT NULL));
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_clave_chk" CHECK ("claveIdempotencia" IS NULL OR "claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
-- Un solo fondo por sesión; una anulación por movimiento; una clave por empresa.
CREATE UNIQUE INDEX "MovimientoCaja_fondo_key" ON "MovimientoCaja"("empresaId", "sesionId") WHERE "clase" = 'FONDO_INICIAL';
CREATE UNIQUE INDEX "MovimientoCaja_anula_key" ON "MovimientoCaja"("empresaId", "anulaAId") WHERE "anulaAId" IS NOT NULL;
CREATE UNIQUE INDEX "MovimientoCaja_clave_key" ON "MovimientoCaja"("empresaId", "claveIdempotencia") WHERE "claveIdempotencia" IS NOT NULL;

-- Cobranza
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_total_chk" CHECK ("total" > 0);
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_clave_chk" CHECK ("claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
ALTER TABLE "Cobranza" ADD CONSTRAINT "Cobranza_huella_chk" CHECK ("huella" ~ '^[0-9a-f]{64}$');

-- Cobro
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_orden_chk" CHECK ("orden" BETWEEN 1 AND 50);
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_importe_chk" CHECK ("importe" > 0);

-- ArqueoCaja: o se contó (efectivo) o se dio conforme (los demás); nunca las dos ni ninguna. Lo esperado puede ser negativo (un egreso mayor al efectivo se permite).
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_contado_o_conforme_chk" CHECK (
  ("conforme" AND "contado" IS NULL AND "contadoMonedas" IS NULL)
  OR (NOT "conforme" AND "contado" IS NOT NULL AND "contado" >= 0 AND ("contadoMonedas" IS NULL OR "contadoMonedas" >= 0)));

-- ArqueoBillete: las denominaciones que se cuentan (src/core/caja/arqueo.ts) y la cantidad.
ALTER TABLE "ArqueoBillete" ADD CONSTRAINT "ArqueoBillete_denominacion_chk" CHECK ("denominacion" IN (20000, 10000, 2000, 1000, 500, 200, 100));
ALTER TABLE "ArqueoBillete" ADD CONSTRAINT "ArqueoBillete_cantidad_chk" CHECK ("cantidad" BETWEEN 0 AND 99999);

-- ===== Disparadores =====

-- SesionCaja: al abrir, ABIERTA, caja de la MISMA sucursal y sucursal activa. Al cambiar, solo ABIERTA → CERRADA, una vez (y solo las columnas del cierre: el resto no tiene UPDATE por privilegio).
CREATE FUNCTION "SesionCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "SesionCaja_validar_ins" BEFORE INSERT ON "SesionCaja" FOR EACH ROW EXECUTE FUNCTION "SesionCaja_validar"();
CREATE TRIGGER "SesionCaja_validar_upd" BEFORE UPDATE ON "SesionCaja" FOR EACH ROW EXECUTE FUNCTION "SesionCaja_validar"();

-- Una fila que cuelga de una sesión (movimiento, cobranza, arqueo, billetes) entra SOLO con la sesión ABIERTA y de su misma sucursal. FOR SHARE: un cierre concurrente espera o choca.
CREATE FUNCTION "SesionCaja_exigir_abierta"(p_empresa text, p_sesion uuid, p_sucursal text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_sucursal text;
BEGIN
  SELECT s."estado", s."sucursalId" INTO v_estado, v_sucursal FROM "SesionCaja" s WHERE s."empresaId" = p_empresa AND s."id" = p_sesion FOR SHARE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'sesion_caja_inexistente' USING ERRCODE = '23503'; END IF;
  IF v_estado <> 'ABIERTA' THEN RAISE EXCEPTION 'sesion_caja_no_abierta' USING ERRCODE = '23514'; END IF;
  IF v_sucursal <> p_sucursal THEN RAISE EXCEPTION 'fila_de_otra_sucursal_que_su_sesion' USING ERRCODE = '23514'; END IF;
END $$;

-- MovimientoCaja
CREATE FUNCTION "MovimientoCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "MovimientoCaja_validar" BEFORE INSERT ON "MovimientoCaja" FOR EACH ROW EXECUTE FUNCTION "MovimientoCaja_validar"();

-- Cobranza: la cuenta es de la MISMA sucursal y está cerrada (cobrar es un paso aparte de cerrar, decisión del dueño 2026-11-16).
CREATE FUNCTION "Cobranza_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sucursal text; v_cerrada timestamptz;
BEGIN
  PERFORM "SesionCaja_exigir_abierta"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  SELECT m."sucursalId", c."cerradaEn" INTO v_sucursal, v_cerrada FROM "Cuenta" c JOIN "Mesa" m ON m."empresaId" = c."empresaId" AND m."id" = c."mesaId" WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cuentaId";
  IF v_sucursal IS DISTINCT FROM NEW."sucursalId" THEN RAISE EXCEPTION 'cobranza_de_cuenta_de_otra_sucursal' USING ERRCODE = '23514'; END IF;
  IF v_cerrada IS NULL THEN RAISE EXCEPTION 'cobranza_de_cuenta_abierta' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Cobranza_validar" BEFORE INSERT ON "Cobranza" FOR EACH ROW EXECUTE FUNCTION "Cobranza_validar"();

-- Cobro: su movimiento es de clase COBRO, del mismo medio, importe y sucursal; su cobranza es de la misma sesión que su movimiento.
CREATE FUNCTION "Cobro_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mv record; cb record;
BEGIN
  SELECT x."clase", x."medioDePagoId", x."importe", x."sucursalId", x."sesionId" INTO mv FROM "MovimientoCaja" x WHERE x."empresaId" = NEW."empresaId" AND x."id" = NEW."movimientoId";
  SELECT y."sucursalId", y."sesionId" INTO cb FROM "Cobranza" y WHERE y."empresaId" = NEW."empresaId" AND y."id" = NEW."cobranzaId";
  IF mv."clase" IS DISTINCT FROM 'COBRO' OR mv."medioDePagoId" <> NEW."medioDePagoId" OR mv."importe" <> NEW."importe" THEN RAISE EXCEPTION 'cobro_no_es_su_movimiento' USING ERRCODE = '23514'; END IF;
  IF mv."sucursalId" <> NEW."sucursalId" OR cb."sucursalId" <> NEW."sucursalId" OR mv."sesionId" <> cb."sesionId" THEN RAISE EXCEPTION 'cobro_de_otra_sucursal_o_sesion' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Cobro_validar" BEFORE INSERT ON "Cobro" FOR EACH ROW EXECUTE FUNCTION "Cobro_validar"();

-- Σ de los renglones = total de la cobranza al centavo. DIFERIDO: se verifica al confirmar la transacción, cuando la cobranza y todos sus renglones ya están.
CREATE FUNCTION "Cobranza_cuadra"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cobranza uuid; v_total numeric; v_suma numeric;
BEGIN
  v_cobranza := CASE TG_TABLE_NAME WHEN 'Cobranza' THEN NEW."id" ELSE NEW."cobranzaId" END;
  SELECT c."total" INTO v_total FROM "Cobranza" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = v_cobranza;
  SELECT COALESCE(sum(r."importe"), 0) INTO v_suma FROM "Cobro" r WHERE r."empresaId" = NEW."empresaId" AND r."cobranzaId" = v_cobranza;
  IF v_suma <> v_total THEN RAISE EXCEPTION 'cobranza_no_cuadra' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Cobranza_cuadra" AFTER INSERT ON "Cobranza" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "Cobranza_cuadra"();
CREATE CONSTRAINT TRIGGER "Cobro_cuadra" AFTER INSERT ON "Cobro" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "Cobranza_cuadra"();

-- ArqueoCaja y ArqueoBillete entran solo con la sesión abierta y de su sucursal (se cierra en la misma transacción).
CREATE FUNCTION "Arqueo_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "SesionCaja_exigir_abierta"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  RETURN NEW;
END $$;
CREATE TRIGGER "ArqueoCaja_validar" BEFORE INSERT ON "ArqueoCaja" FOR EACH ROW EXECUTE FUNCTION "Arqueo_validar"();
CREATE TRIGGER "ArqueoBillete_validar" BEFORE INSERT ON "ArqueoBillete" FOR EACH ROW EXECUTE FUNCTION "Arqueo_validar"();

-- Al CERRAR la sesión (DIFERIDO, ya con todo escrito): el arqueo recalcula lo esperado por medio desde los movimientos y exige que haya una línea por cada medio con movimientos, que el efectivo esté CONTADO y que
-- billetes + monedas den lo contado. Si un cobro se coló entre medio, la línea no cuadra y el cierre falla entero.
CREATE FUNCTION "SesionCaja_verificar_cierre"() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER "SesionCaja_verificar_cierre" AFTER UPDATE ON "SesionCaja" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "SesionCaja_verificar_cierre"();

-- ===== RLS por empresa (las políticas por sucursal van en 20261117111000) =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Caja', 'MedioDePago', 'SesionCaja', 'MovimientoCaja', 'Cobranza', 'Cobro', 'ArqueoCaja', 'ArqueoBillete'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()))', t);
  END LOOP;
END
$$;

-- ===== Privilegios (si los roles existen): leer y agregar; NUNCA borrar. UPDATE solo por columna donde hace falta. La consola de plataforma no las toca. =====
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    FOREACH t IN ARRAY ARRAY['Caja', 'MedioDePago', 'SesionCaja', 'MovimientoCaja', 'Cobranza', 'Cobro', 'ArqueoCaja', 'ArqueoBillete'] LOOP
      EXECUTE format('REVOKE ALL ON %I FROM motor2_app', t);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO motor2_app', t);
    END LOOP;
    GRANT UPDATE ("nombre", "activo", "actualizadoEn", "version") ON "MedioDePago" TO motor2_app;
    GRANT UPDATE ("estado", "cerradaEn", "cerradaPorId", "observacion") ON "SesionCaja" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    FOREACH t IN ARRAY ARRAY['Caja', 'MedioDePago', 'SesionCaja', 'MovimientoCaja', 'Cobranza', 'Cobro', 'ArqueoCaja', 'ArqueoBillete'] LOOP
      EXECUTE format('REVOKE ALL ON %I FROM motor2_plataforma', t);
    END LOOP;
  END IF;
END
$$;
