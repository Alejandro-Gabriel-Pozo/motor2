-- E3a-M (ADR-041), REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon). El dueño la autorizó el 2026-10-28 SOLO en bases locales (subir/bajar/subir).
--
-- QUÉ: la factura de proveedor repartida entre sucursales por PROPUESTA (la sucursal que carga) y ACEPTACIÓN (cada sucursal destino), docs/diseno-factura-de-proveedor-e3a-2026-10-27.md §7 y §11 paso 3.
-- Tres tablas NUEVAS; no se toca ninguna tabla, política ni migración existente (la parte `FacturaProveedorSucursal` sigue `PROPIA` con sus políticas de M3c intactas):
--  1. `FacturaProveedorPropuesta`: la propuesta de la parte de UNA sucursal destino. La crea la sucursal que carga (`origenSucursalId`) y la acepta la destino (`destinoSucursalId`); al aceptar, la destino inserta su
--     `FacturaProveedorSucursal` ya RECIBIDA (dentro de su propio alcance) y la propuesta queda ACEPTADA con esa parte. Alcance `ENTRE_SUCURSALES` (las políticas por sucursal van en la migración siguiente, salida exacta
--     del generador). UPDATE solo de las cuatro columnas de la aceptación (`estado`, `aceptadaEn`, `aceptadaPorId`, `parteId`); nunca DELETE. Sin disparador (regla de la etapa): volver de ACEPTADA a PENDIENTE lo
--     impide el caso de uso con `WHERE estado = 'PENDIENTE'`, no la base.
--  2. `FacturaProveedorPropuestaRenglon`: cuánta cantidad y cuántos pesos de cada renglón le tocan a esa destino (lo que se acepta tal cual). Clave foránea de CINCO columnas hacia su propuesta: la propuesta, su factura y
--     sus dos sucursales coinciden; y de TRES hacia el renglón: el renglón es de la MISMA factura. Solo SELECT e INSERT.
--  3. `AnulacionDeFacturaProveedor`: la anulación de una factura como registro nuevo (una por factura): motivo, clave de reintento (única GLOBAL, ADR-028) y huella, y el mensaje devuelto (I3). Solo SELECT e INSERT.
--
-- QUÉ DECIDE LA BASE: una propuesta por (factura, destino); origen distinto del destino; porcentaje 1..10000; estado de lista cerrada; la aceptación (cuándo, quién, la parte) existe si y solo si está ACEPTADA; una
-- parte la acepta a lo sumo una propuesta; un renglón por (propuesta, renglón) con cantidad > 0 y pesos >= 0; que todo sea de la misma factura y de las mismas sucursales; una anulación por factura; la clave única.
-- QUÉ DECIDE EL CASO DE USO (no se expresa sin disparador o leyendo otras filas): que la parte propia más las propuestas sumen 10000 puntos básicos, que los renglones de las propuestas más la parte propia sumen cada
-- renglón, que se acepte exactamente lo propuesto, que la factura no esté anulada al aceptar, y quién puede qué.
--
-- ADITIVA: el código anterior no lee ni escribe estas tablas. Índices sin CONCURRENTLY (tablas nuevas y vacías, ADR-029 §8).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261028100000_factura_proveedor_propuesta`). Bajar ANTES la de políticas
-- (20261028101000). La reversa ABORTA si hay filas (se perderían propuestas o anulaciones).

-- CreateTable
CREATE TABLE "FacturaProveedorPropuesta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "origenSucursalId" TEXT NOT NULL,
    "destinoSucursalId" TEXT NOT NULL,
    "porcentajeDeclaradoBp" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "aceptadaEn" TIMESTAMP(3),
    "aceptadaPorId" TEXT,
    "parteId" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaProveedorPropuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacturaProveedorPropuestaRenglon" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "propuestaId" TEXT NOT NULL,
    "origenSucursalId" TEXT NOT NULL,
    "destinoSucursalId" TEXT NOT NULL,
    "facturaProveedorRenglonId" TEXT NOT NULL,
    "cantidadStock" DECIMAL(14,4) NOT NULL,
    "precioTotal" DECIMAL(14,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaProveedorPropuestaRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnulacionDeFacturaProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnulacionDeFacturaProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacturaProveedorPropuesta_destinoSucursalId_estado_idx" ON "FacturaProveedorPropuesta"("destinoSucursalId", "estado");

-- CreateIndex
CREATE INDEX "FacturaProveedorPropuesta_origenSucursalId_idx" ON "FacturaProveedorPropuesta"("origenSucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuesta_empresaId_id_key" ON "FacturaProveedorPropuesta"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuesta_destino_de_renglones_key" ON "FacturaProveedorPropuesta"("empresaId", "facturaProveedorId", "id", "origenSucursalId", "destinoSucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuesta_facturaProveedorId_destinoSucursa_key" ON "FacturaProveedorPropuesta"("facturaProveedorId", "destinoSucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuesta_empresaId_parteId_key" ON "FacturaProveedorPropuesta"("empresaId", "parteId");

-- CreateIndex
CREATE INDEX "FacturaProveedorPropuestaRenglon_facturaProveedorRenglonId_idx" ON "FacturaProveedorPropuestaRenglon"("facturaProveedorRenglonId");

-- CreateIndex
CREATE INDEX "FacturaProveedorPropuestaRenglon_destinoSucursalId_idx" ON "FacturaProveedorPropuestaRenglon"("destinoSucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuestaRenglon_empresaId_id_key" ON "FacturaProveedorPropuestaRenglon"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FacturaProveedorPropuestaRenglon_propuestaId_facturaProveed_key" ON "FacturaProveedorPropuestaRenglon"("propuestaId", "facturaProveedorRenglonId");

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDeFacturaProveedor_claveIdempotencia_key" ON "AnulacionDeFacturaProveedor"("claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDeFacturaProveedor_empresaId_id_key" ON "AnulacionDeFacturaProveedor"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnulacionDeFacturaProveedor_facturaProveedorId_key" ON "AnulacionDeFacturaProveedor"("facturaProveedorId");

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_factura_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_origen_fkey" FOREIGN KEY ("empresaId", "origenSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_destino_fkey" FOREIGN KEY ("empresaId", "destinoSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_aceptadaPor_fkey" FOREIGN KEY ("aceptadaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_parte_fkey" FOREIGN KEY ("empresaId", "parteId") REFERENCES "FacturaProveedorSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_creadoPor_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_propuesta_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "propuestaId", "origenSucursalId", "destinoSucursalId") REFERENCES "FacturaProveedorPropuesta"("empresaId", "facturaProveedorId", "id", "origenSucursalId", "destinoSucursalId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_origen_fkey" FOREIGN KEY ("empresaId", "origenSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_destino_fkey" FOREIGN KEY ("empresaId", "destinoSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_renglon_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnulacionDeFacturaProveedor" ADD CONSTRAINT "AnulacionDeFacturaProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnulacionDeFacturaProveedor" ADD CONSTRAINT "AnulacionDeFacturaProveedor_factura_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnulacionDeFacturaProveedor" ADD CONSTRAINT "AnulacionDeFacturaProveedor_creadoPor_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre)
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_sucursales_distintas_chk" CHECK ("origenSucursalId" <> "destinoSucursalId");
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_porcentaje_chk" CHECK ("porcentajeDeclaradoBp" BETWEEN 1 AND 10000);
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_estado_chk" CHECK ("estado" IN ('PENDIENTE', 'ACEPTADA'));
ALTER TABLE "FacturaProveedorPropuesta" ADD CONSTRAINT "FacturaProveedorPropuesta_aceptacion_coherente_chk"
  CHECK (("estado" = 'ACEPTADA') = ("aceptadaEn" IS NOT NULL) AND ("aceptadaEn" IS NULL) = ("aceptadaPorId" IS NULL) AND ("aceptadaEn" IS NULL) = ("parteId" IS NULL));
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_cantidad_positiva_chk" CHECK ("cantidadStock" > 0);
ALTER TABLE "FacturaProveedorPropuestaRenglon" ADD CONSTRAINT "FacturaProveedorPropuestaRenglon_precio_no_negativo_chk" CHECK ("precioTotal" >= 0);
ALTER TABLE "AnulacionDeFacturaProveedor" ADD CONSTRAINT "AnulacionDeFacturaProveedor_motivo_chk" CHECK ("motivo" ~ '\S' AND char_length("motivo") <= 200);

-- RLS por empresa (las políticas por sucursal de las dos primeras van en 20261028101000)
ALTER TABLE "FacturaProveedorPropuesta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedorPropuesta"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "FacturaProveedorPropuestaRenglon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedorPropuestaRenglon"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "AnulacionDeFacturaProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "AnulacionDeFacturaProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): solo se agrega; la propuesta además admite UPDATE de su aceptación.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon", "AnulacionDeFacturaProveedor" FROM motor2_app;
    GRANT SELECT, INSERT ON "FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon", "AnulacionDeFacturaProveedor" TO motor2_app;
    GRANT UPDATE ("estado", "aceptadaEn", "aceptadaPorId", "parteId") ON "FacturaProveedorPropuesta" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon", "AnulacionDeFacturaProveedor" FROM motor2_plataforma;
  END IF;
END
$$;
