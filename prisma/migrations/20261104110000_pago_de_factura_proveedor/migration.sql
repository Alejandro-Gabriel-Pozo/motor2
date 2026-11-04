-- Pagos, etapa X0 (docs/diseno-pagos-x0-2026-11-04.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una rama de Neon): «declarar el pago» de una factura de proveedor.
--
-- Necesidad (dueño, 2026-11-04): cargar la factura sin pagarla («pendiente de pago») y después confirmar cuándo y cómo se pagó; el flujo de caja es del mes del pago.
--
-- QUÉ HACE (ADITIVA, el código anterior sigue andando: nunca escribe `PENDIENTE_DE_PAGO` ni lee las tablas nuevas):
--  1. Amplía el CHECK `FacturaProveedor_condicion_pago_chk` a `CONTADO_PAGADA` | `PENDIENTE_DE_PAGO`. La condición sigue sin UPDATE (inmutable): se anula y se vuelve a cargar. Las columnas viejas `fechaPagoDeclarada` y
--     `medioPagoDeclarado` de la factura NO se usan (candidatas a poda en X3); su CHECK `..._pago_declarado_solo_contado_chk` queda como está.
--  2. `PagoDeFacturaProveedor`: el pago declarado como REGISTRO APARTE que solo se agrega (fecha del día, medio de lista cerrada, quién, cuándo, clave de reintento única GLOBAL —ADR-028— y huella). Un ÚNICO pago vigente por
--     factura (índice único parcial `PagoDeFacturaProveedor_vigente_key`: la base arbitra dos declaraciones simultáneas). La app tiene SELECT, INSERT y UPDATE solo de `anuladoEn`/`anuladoPorId` (nunca DELETE).
--  3. `AnulacionDePagoDeFacturaProveedor`: la anulación de un pago como registro nuevo (una por pago): motivo, clave única y huella. Solo SELECT e INSERT.
-- No guarda importes ni moneda: X0 paga la factura entera (su `importeTotal`, en pesos). X3 los agrega de forma aditiva al convertir cada pago en una imputación a su factura.
--
-- QUÉ DECIDE LA BASE: condición de lista cerrada; medio de lista cerrada; el pareo de la anulación (`anuladoEn` y `anuladoPorId` van juntos); un único pago vigente por factura; una anulación por pago; claves únicas; el motivo
-- (1 a 200 caracteres con algo visible). QUÉ DECIDE EL CASO DE USO (no se expresa sin leer otras filas): que la factura sea `PENDIENTE_DE_PAGO` y no esté anulada, que la fecha no sea anterior al día de la factura ni posterior a hoy
-- (Argentina), y el permiso `declarar_pago_compra`.
--
-- RLS por empresa (`aislamiento_empresa`) en las dos tablas; FK compuesta `(empresaId, facturaProveedorId)`. Sin política por sucursal: la factura es un documento de la EMPRESA (ADR-029).
-- Índices sin CONCURRENTLY (tablas nuevas y vacías). Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261104110000_pago_de_factura_proveedor`).
-- La reversa ABORTA si hay filas en las tablas nuevas o facturas `PENDIENTE_DE_PAGO`. Bajar ANTES la de datos 20261104111000 solo si se quiere sacar también el permiso (no depende de esta).

-- La condición de pago admite la pendiente (mismo nombre de CHECK).
ALTER TABLE "FacturaProveedor" DROP CONSTRAINT "FacturaProveedor_condicion_pago_chk";
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_condicion_pago_chk" CHECK ("condicionPago" IN ('CONTADO_PAGADA', 'PENDIENTE_DE_PAGO'));

-- CreateTable
CREATE TABLE "PagoDeFacturaProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "fechaPago" DATE NOT NULL,
    "medio" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPorId" TEXT,

    CONSTRAINT "PagoDeFacturaProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnulacionDePagoDeFacturaProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "pagoId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnulacionDePagoDeFacturaProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PagoDeFacturaProveedor_claveIdempotencia_key" ON "PagoDeFacturaProveedor"("claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "PagoDeFacturaProveedor_empresaId_id_key" ON "PagoDeFacturaProveedor"("empresaId", "id");

-- CreateIndex
CREATE INDEX "PagoDeFacturaProveedor_facturaProveedorId_idx" ON "PagoDeFacturaProveedor"("facturaProveedorId");

-- CreateIndex
CREATE INDEX "PagoDeFacturaProveedor_empresaId_fechaPago_idx" ON "PagoDeFacturaProveedor"("empresaId", "fechaPago");

-- Un único pago VIGENTE por factura (índice parcial: Prisma no los declara, vive solo acá, como `FacturaProveedor_unica_vigente_key`).
CREATE UNIQUE INDEX "PagoDeFacturaProveedor_vigente_key" ON "PagoDeFacturaProveedor"("facturaProveedorId") WHERE "anuladoEn" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDePagoDeFacturaProveedor_claveIdempotencia_key" ON "AnulacionDePagoDeFacturaProveedor"("claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDePagoDeFacturaProveedor_empresaId_id_key" ON "AnulacionDePagoDeFacturaProveedor"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDePagoDeFacturaProveedor_pagoId_key" ON "AnulacionDePagoDeFacturaProveedor"("pagoId");

-- AddForeignKey
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_factura_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_creadoPor_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_anuladoPor_fkey" FOREIGN KEY ("anuladoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnulacionDePagoDeFacturaProveedor" ADD CONSTRAINT "AnulacionDePagoDeFacturaProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnulacionDePagoDeFacturaProveedor" ADD CONSTRAINT "AnulacionDePagoDeFacturaProveedor_pago_fkey" FOREIGN KEY ("empresaId", "pagoId") REFERENCES "PagoDeFacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnulacionDePagoDeFacturaProveedor" ADD CONSTRAINT "AnulacionDePagoDeFacturaProveedor_creadoPor_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre)
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_medio_chk" CHECK ("medio" IN ('TRANSFERENCIA', 'EFECTIVO', 'CHEQUE', 'TARJETA', 'OTRO'));
ALTER TABLE "PagoDeFacturaProveedor" ADD CONSTRAINT "PagoDeFacturaProveedor_anulacion_pareo_chk" CHECK (("anuladoEn" IS NULL) = ("anuladoPorId" IS NULL));
ALTER TABLE "AnulacionDePagoDeFacturaProveedor" ADD CONSTRAINT "AnulacionDePagoDeFacturaProveedor_motivo_chk" CHECK ("motivo" ~ '\S' AND char_length("motivo") <= 200);

-- RLS por empresa
ALTER TABLE "PagoDeFacturaProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PagoDeFacturaProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "AnulacionDePagoDeFacturaProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "AnulacionDePagoDeFacturaProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): solo se agrega; el pago admite además el UPDATE de su marca de anulación.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PagoDeFacturaProveedor", "AnulacionDePagoDeFacturaProveedor" FROM motor2_app;
    GRANT SELECT, INSERT ON "PagoDeFacturaProveedor", "AnulacionDePagoDeFacturaProveedor" TO motor2_app;
    GRANT UPDATE ("anuladoEn", "anuladoPorId") ON "PagoDeFacturaProveedor" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PagoDeFacturaProveedor", "AnulacionDePagoDeFacturaProveedor" FROM motor2_plataforma;
  END IF;
END
$$;
