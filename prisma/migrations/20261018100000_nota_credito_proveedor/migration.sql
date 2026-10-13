-- Paquete 4, M6.1 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la NOTA DE CRÉDITO DE PROVEEDOR (solo el modelo de datos: las tablas nacen vacías y nada de `src/` las lee ni las escribe hasta la Etapa C).
--
-- QUÉ ES CADA TABLA Y DE QUIÉN:
--  * `NotaCreditoProveedor` (cabecera): DE EMPRESA. Quien recibe el crédito es la empresa, igual que la factura; el árbitro de la unicidad del número tiene que ver todas las notas (con una política por sucursal, una sucursal no vería la nota de otra). Sin
--    `sucursalId`: la sucursal de una nota suelta la declaran sus imputaciones. `tipo` es SOBRE_FACTURA (con factura) o SUELTA (sin factura), en pareo (CHECK).
--  * `NotaCreditoProveedorLinea`: DE EMPRESA, espejo del renglón de la factura. Una línea acredita exactamente UN renglón de la factura de su nota (o, en una nota suelta, declara su naturaleza y, si es gasto, su concepto y una COPIA del tipo de costo).
--  * `NotaCreditoProveedorImputacion`: DE LA SUCURSAL (`PROPIA`, `sucursalId` NOT NULL con clave foránea a Sucursal; sus políticas de RLS por sucursal van en la migración siguiente, M6.2). Lleva la CANTIDAD y la DEVOLUCIÓN (`Operacion` DEVOLUCION_PROVEEDOR): puede apuntar
--    a `Operacion` porque la regla R8 solo restringe a las tablas DE EMPRESA. Molde: `ImputacionDeGasto`.
--  * `NotaCreditoProveedorTributo`: DE EMPRESA, espejo de `FacturaProveedorTributo` (percepciones e impuestos que acredita la nota además del IVA).
--
-- QUÉ IMPIDE CADA CLAVE FORÁNEA DE TRES COLUMNAS (la base, aun escribiendo como dueño):
--  * `NotaCreditoProveedor_factura_fkey` (empresaId, facturaProveedorId, proveedorId) → FacturaProveedor: la nota es del MISMO proveedor que su factura, y corregir el proveedor de una factura que tiene notas se rechaza (ON UPDATE RESTRICT).
--  * `NotaCreditoProveedorLinea_nota_tipo_fkey` (empresaId, nota, tipoNota) → NotaCreditoProveedor(empresaId, id, tipo): el tipo de la línea es el de su nota (una línea suelta no cuelga de una nota con factura).
--  * `NotaCreditoProveedorLinea_nota_factura_fkey` (empresaId, nota, facturaProveedorId) → NotaCreditoProveedor(empresaId, id, facturaProveedorId): la factura de la línea es la de su nota.
--  * `NotaCreditoProveedorLinea_renglon_factura_fkey` (empresaId, facturaProveedorId, renglón) → FacturaProveedorRenglon(empresaId, facturaProveedorId, id): el renglón es de LA factura de la nota.
--  * `NotaCreditoProveedorLinea_renglon_naturaleza_fkey` (empresaId, renglón, naturaleza) → FacturaProveedorRenglon(empresaId, id, naturaleza): la naturaleza de la línea es la del renglón (reusa el índice de M4.2).
--  * `NotaCreditoProveedorImputacion_linea_fkey` (empresaId, línea, lineaAdmiteDevolucion) → NotaCreditoProveedorLinea(empresaId, id, admiteDevolucion): solo una línea de mercadería sobre factura puede llevar una devolución (más el CHECK de la devolución).
--
-- LO QUE NO DECIDE LA BASE: el TOPE de lo acreditado (por renglón, por sucursal, por cantidad y por factura) NO se puede expresar en la base sin un disparador, y la regla de la etapa es «sin disparadores»: lo impone el caso de uso (Etapa C) con
-- `SELECT … FOR UPDATE` sobre la fila de la factura, como primera sentencia de la transacción (ADR-029 §12). También son del caso de uso que Σ líneas + Σ tributos = total y Σ imputaciones = importe de la línea.
--
-- SOLO SE AGREGA: `motor2_app` tiene SELECT e INSERT en las cuatro tablas, nunca DELETE; UPDATE solo por columna en la cabecera: la anulación (`anuladaEn`, `anuladaPorId`, `motivoAnulacion`, siempre las tres juntas) y la recepción en administración. `motor2_plataforma` no toca nada.
-- Una nota anulada libera su número: el índice único parcial `NotaCreditoProveedor_unica_vigente_key` solo cuenta las notas NO anuladas.
--
-- DINERO: todo `DECIMAL(14,2)` (la cantidad, `DECIMAL(14,4)`), nunca float. Sin columna de moneda (es la de la empresa, igual que la factura).
--
-- ADITIVA: tablas nuevas y vacías; sin CONCURRENTLY (en la misma transacción que corre Prisma), con `SET lock_timeout = '5s'` al aplicar: las claves foráneas toman SHARE ROW EXCLUSIVE sobre `Operacion`, `FacturaProveedor`, `FacturaProveedorRenglon`, `Proveedor`,
-- `ConceptoDeGasto`, `Sucursal`, `User` y `Empresa`. Los dos índices únicos de destino que se agregan a las tablas de M3 caen sobre las filas existentes.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; ABORTA si alguna tabla tiene filas; después `prisma migrate resolve --rolled-back 20261018100000_nota_credito_proveedor`). Bajar ANTES M6.2. Con M6 arriba FALLAN (a propósito) las reversas de M4.2, M4.1 y M3b.

-- Los destinos de las claves foráneas de tres columnas, en las tablas de M3.
CREATE UNIQUE INDEX "FacturaProveedor_empresaId_id_proveedorId_key" ON "FacturaProveedor"("empresaId", "id", "proveedorId");
CREATE UNIQUE INDEX "FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key" ON "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", "id");

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- NotaCreditoProveedor (cabecera, DE EMPRESA)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "NotaCreditoProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "proveedorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "facturaProveedorId" TEXT,
    "nroComprobante" TEXT NOT NULL,
    "nroComprobanteNormalizado" TEXT NOT NULL,
    "letra" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaComprobante" DATE,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "condicionIvaEmpresa" TEXT,
    "importeNeto" DECIMAL(14,2),
    "importeIva" DECIMAL(14,2),
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "origen" TEXT NOT NULL DEFAULT 'CARGA',
    "recibidaEnAdministracionEn" DATE,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorId" TEXT,
    "motivoAnulacion" TEXT,

    CONSTRAINT "NotaCreditoProveedor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotaCreditoProveedor_empresaId_id_key" ON "NotaCreditoProveedor"("empresaId", "id");
-- Los destinos de las claves foráneas de la línea (tipo de la nota y factura de la nota).
CREATE UNIQUE INDEX "NotaCreditoProveedor_empresaId_id_tipo_key" ON "NotaCreditoProveedor"("empresaId", "id", "tipo");
CREATE UNIQUE INDEX "NotaCreditoProveedor_empresaId_id_facturaProveedorId_key" ON "NotaCreditoProveedor"("empresaId", "id", "facturaProveedorId");
CREATE UNIQUE INDEX "NotaCreditoProveedor_claveIdempotencia_key" ON "NotaCreditoProveedor"("claveIdempotencia");
-- Para el aviso de posible duplicado (C25) y la lectura por proveedor y período.
CREATE INDEX "NotaCreditoProveedor_empresaId_proveedorId_fecha_idx" ON "NotaCreditoProveedor"("empresaId", "proveedorId", "fecha");
CREATE INDEX "NotaCreditoProveedor_facturaProveedorId_idx" ON "NotaCreditoProveedor"("facturaProveedorId");
-- El número único entre las notas VIGENTES de un proveedor (la letra vacía cuenta como '', igual que la factura): una nota anulada libera el número. Prisma no modela el índice parcial.
CREATE UNIQUE INDEX "NotaCreditoProveedor_unica_vigente_key"
  ON "NotaCreditoProveedor" ("empresaId", "proveedorId", COALESCE("letra", ''), "nroComprobanteNormalizado") WHERE "anuladaEn" IS NULL;

ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- De TRES columnas: la factura de la nota es del mismo proveedor, y no se corrige el proveedor de una factura que tiene notas (ON UPDATE RESTRICT).
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_factura_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "proveedorId") REFERENCES "FacturaProveedor"("empresaId", "id", "proveedorId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_tipo_chk" CHECK (("tipo" = 'SOBRE_FACTURA' AND "facturaProveedorId" IS NOT NULL) OR ("tipo" = 'SUELTA' AND "facturaProveedorId" IS NULL));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_nro_chk" CHECK (length(btrim("nroComprobante")) > 0 AND length(btrim("nroComprobanteNormalizado")) > 0);
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_letra_chk" CHECK ("letra" IS NULL OR "letra" IN ('A', 'B', 'C', 'E', 'M', 'X'));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_importe_total_positivo_chk" CHECK ("importeTotal" > 0);
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_condicion_iva_empresa_chk" CHECK ("condicionIvaEmpresa" IS NULL OR "condicionIvaEmpresa" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_desglose_pareo_chk" CHECK (("importeNeto" IS NULL) = ("importeIva" IS NULL));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_desglose_no_negativo_chk" CHECK (("importeNeto" IS NULL OR "importeNeto" >= 0) AND ("importeIva" IS NULL OR "importeIva" >= 0));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_desglose_dentro_del_total_chk" CHECK ("importeNeto" IS NULL OR "importeNeto" + "importeIva" <= "importeTotal");
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_motivo_chk" CHECK ("motivo" ~ '\S' AND char_length("motivo") <= 200);
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_estado_chk" CHECK ("estado" IN ('CONFIRMADA'));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_origen_chk" CHECK ("origen" IN ('CARGA'));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_anulacion_pareo_chk" CHECK (("anuladaEn" IS NULL) = ("anuladaPorId" IS NULL) AND ("anuladaEn" IS NULL) = ("motivoAnulacion" IS NULL));
ALTER TABLE "NotaCreditoProveedor" ADD CONSTRAINT "NotaCreditoProveedor_motivo_anulacion_chk" CHECK ("motivoAnulacion" IS NULL OR ("motivoAnulacion" ~ '\S' AND char_length("motivoAnulacion") <= 200));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- NotaCreditoProveedorLinea (DE EMPRESA)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "NotaCreditoProveedorLinea" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "notaCreditoProveedorId" TEXT NOT NULL,
    "tipoNota" TEXT NOT NULL,
    "facturaProveedorId" TEXT,
    "orden" INTEGER NOT NULL,
    "facturaProveedorRenglonId" TEXT,
    "naturaleza" TEXT NOT NULL,
    "admiteDevolucion" BOOLEAN NOT NULL,
    "origenImporte" TEXT NOT NULL,
    "descripcion" TEXT,
    "conceptoGastoId" TEXT,
    "tipoDeCosto" TEXT,
    "importe" DECIMAL(14,2) NOT NULL,
    "alicuotaIva" TEXT,
    "importeNeto" DECIMAL(14,2),
    "importeIva" DECIMAL(14,2),
    "importeIvaComputable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaCreditoProveedorLinea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotaCreditoProveedorLinea_empresaId_id_key" ON "NotaCreditoProveedorLinea"("empresaId", "id");
-- El destino de la clave foránea con discriminador de la imputación.
CREATE UNIQUE INDEX "NotaCreditoProveedorLinea_empresaId_id_admiteDevolucion_key" ON "NotaCreditoProveedorLinea"("empresaId", "id", "admiteDevolucion");
CREATE UNIQUE INDEX "NotaCreditoProveedorLinea_notaCreditoProveedorId_orden_key" ON "NotaCreditoProveedorLinea"("notaCreditoProveedorId", "orden");
CREATE INDEX "NotaCreditoProveedorLinea_facturaProveedorRenglonId_idx" ON "NotaCreditoProveedorLinea"("facturaProveedorRenglonId");
CREATE INDEX "NotaCreditoProveedorLinea_conceptoGastoId_idx" ON "NotaCreditoProveedorLinea"("conceptoGastoId");

ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_nota_tipo_fkey" FOREIGN KEY ("empresaId", "notaCreditoProveedorId", "tipoNota") REFERENCES "NotaCreditoProveedor"("empresaId", "id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_nota_factura_fkey" FOREIGN KEY ("empresaId", "notaCreditoProveedorId", "facturaProveedorId") REFERENCES "NotaCreditoProveedor"("empresaId", "id", "facturaProveedorId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_renglon_factura_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_renglon_naturaleza_fkey" FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturaleza") REFERENCES "FacturaProveedorRenglon"("empresaId", "id", "naturaleza") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_empresaId_conceptoGastoId_fkey" FOREIGN KEY ("empresaId", "conceptoGastoId") REFERENCES "ConceptoDeGasto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_tipo_nota_chk" CHECK ("tipoNota" IN ('SOBRE_FACTURA', 'SUELTA'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_referencia_chk" CHECK (
  ("tipoNota" = 'SOBRE_FACTURA' AND "facturaProveedorId" IS NOT NULL AND "facturaProveedorRenglonId" IS NOT NULL AND "origenImporte" IN ('RENGLON', 'REPARTO_DEL_TOTAL') AND "conceptoGastoId" IS NULL AND "tipoDeCosto" IS NULL)
  OR ("tipoNota" = 'SUELTA' AND "facturaProveedorId" IS NULL AND "facturaProveedorRenglonId" IS NULL AND "origenImporte" = 'SIN_FACTURA'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_naturaleza_chk" CHECK ("naturaleza" IN ('MERCADERIA', 'SIN_STOCK'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_pareo_suelta_chk" CHECK (
  "tipoNota" = 'SOBRE_FACTURA'
  OR ("naturaleza" = 'SIN_STOCK' AND "conceptoGastoId" IS NOT NULL AND "tipoDeCosto" IS NOT NULL)
  OR ("naturaleza" = 'MERCADERIA' AND "conceptoGastoId" IS NULL AND "tipoDeCosto" IS NULL));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_tipo_de_costo_chk" CHECK ("tipoDeCosto" IS NULL OR "tipoDeCosto" IN ('COSTO_DE_VENTAS', 'GASTO_OPERATIVO', 'EXTRAORDINARIO', 'INVERSION', 'RESULTADO_FINANCIERO'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_admite_devolucion_chk" CHECK ("admiteDevolucion" = ("tipoNota" = 'SOBRE_FACTURA' AND "naturaleza" = 'MERCADERIA'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_orden_chk" CHECK ("orden" >= 1);
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_importe_positivo_chk" CHECK ("importe" > 0);
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_alicuota_iva_chk" CHECK ("alicuotaIva" IS NULL OR "alicuotaIva" IN ('IVA_0', 'IVA_2_5', 'IVA_5', 'IVA_10_5', 'IVA_21', 'IVA_27', 'EXENTO', 'NO_GRAVADO'));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_desglose_pareo_chk" CHECK (("importeNeto" IS NULL) = ("importeIva" IS NULL));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_desglose_no_negativo_chk" CHECK (("importeNeto" IS NULL OR "importeNeto" >= 0) AND ("importeIva" IS NULL OR "importeIva" >= 0));
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_neto_mas_iva_chk" CHECK ("importeNeto" IS NULL OR "importeNeto" + "importeIva" = "importe");
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_alicuota_sin_iva_chk" CHECK ("alicuotaIva" IS NULL OR "importeIva" IS NULL OR "alicuotaIva" NOT IN ('IVA_0', 'EXENTO', 'NO_GRAVADO') OR "importeIva" = 0);
ALTER TABLE "NotaCreditoProveedorLinea" ADD CONSTRAINT "NotaCreditoProveedorLinea_iva_computable_chk" CHECK ("importeIvaComputable" >= 0 AND "importeIvaComputable" <= COALESCE("importeIva", 0));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- NotaCreditoProveedorImputacion (DE LA SUCURSAL, `PROPIA`)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "NotaCreditoProveedorImputacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "notaCreditoProveedorLineaId" TEXT NOT NULL,
    "lineaAdmiteDevolucion" BOOLEAN NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "importeIvaComputable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cantidadStock" DECIMAL(14,4),
    "operacionDevolucionId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaCreditoProveedorImputacion_pkey" PRIMARY KEY ("id")
);

-- (empresaId, id): destino de futuras claves foráneas compuestas (el centro de costo de M7).
CREATE UNIQUE INDEX "NotaCreditoProveedorImputacion_empresaId_id_key" ON "NotaCreditoProveedorImputacion"("empresaId", "id");
-- Una sola parte por (línea, sucursal).
CREATE UNIQUE INDEX "NotaCreditoProveedorImputacion_linea_sucursal_key" ON "NotaCreditoProveedorImputacion"("notaCreditoProveedorLineaId", "sucursalId");
-- Una devolución se acredita UNA sola vez (el riesgo ALTO de acreditar dos veces lo mismo). NULL no choca con NULL.
CREATE UNIQUE INDEX "NotaCreditoProveedorImputacion_devolucion_key" ON "NotaCreditoProveedorImputacion"("empresaId", "operacionDevolucionId");
CREATE INDEX "NotaCreditoProveedorImputacion_sucursalId_idx" ON "NotaCreditoProveedorImputacion"("sucursalId");

ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_linea_fkey" FOREIGN KEY ("empresaId", "notaCreditoProveedorLineaId", "lineaAdmiteDevolucion") REFERENCES "NotaCreditoProveedorLinea"("empresaId", "id", "admiteDevolucion") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_devolucion_fkey" FOREIGN KEY ("empresaId", "operacionDevolucionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_importe_positivo_chk" CHECK ("importe" > 0);
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_iva_computable_chk" CHECK ("importeIvaComputable" >= 0 AND "importeIvaComputable" <= "importe");
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_cantidad_positiva_chk" CHECK ("cantidadStock" IS NULL OR "cantidadStock" > 0);
-- La cantidad va solo con una devolución, y la devolución solo con una línea de mercadería sobre factura.
ALTER TABLE "NotaCreditoProveedorImputacion" ADD CONSTRAINT "NotaCreditoProveedorImputacion_devolucion_chk" CHECK (("cantidadStock" IS NULL) = ("operacionDevolucionId" IS NULL) AND ("operacionDevolucionId" IS NULL OR "lineaAdmiteDevolucion"));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- NotaCreditoProveedorTributo (DE EMPRESA)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "NotaCreditoProveedorTributo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "notaCreditoProveedorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "importe" DECIMAL(14,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaCreditoProveedorTributo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotaCreditoProveedorTributo_empresaId_id_key" ON "NotaCreditoProveedorTributo"("empresaId", "id");
CREATE INDEX "NotaCreditoProveedorTributo_notaCreditoProveedorId_idx" ON "NotaCreditoProveedorTributo"("notaCreditoProveedorId");

ALTER TABLE "NotaCreditoProveedorTributo" ADD CONSTRAINT "NotaCreditoProveedorTributo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedorTributo" ADD CONSTRAINT "NotaCreditoProveedorTributo_nota_fkey" FOREIGN KEY ("empresaId", "notaCreditoProveedorId") REFERENCES "NotaCreditoProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaCreditoProveedorTributo" ADD CONSTRAINT "NotaCreditoProveedorTributo_tipo_chk" CHECK ("tipo" IN ('PERCEPCION_IVA', 'PERCEPCION_IIBB', 'PERCEPCION_GANANCIAS', 'IMPUESTO_INTERNO', 'IMPUESTO_MUNICIPAL', 'OTRO'));
ALTER TABLE "NotaCreditoProveedorTributo" ADD CONSTRAINT "NotaCreditoProveedorTributo_importe_positivo_chk" CHECK ("importe" > 0);

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- RLS de empresa (misma forma exacta que `ImputacionDeGasto`, una política por tabla; sin FORCE).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "NotaCreditoProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "NotaCreditoProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

ALTER TABLE "NotaCreditoProveedorLinea" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "NotaCreditoProveedorLinea"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

ALTER TABLE "NotaCreditoProveedorImputacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "NotaCreditoProveedorImputacion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

ALTER TABLE "NotaCreditoProveedorTributo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "NotaCreditoProveedorTributo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Los privilegios por defecto le dan DML completo a `motor2_app` sobre las tablas nuevas: se le quitan TODOS y se le devuelve lo mínimo (solo agregar; en la cabecera, UPDATE por
-- columna de la anulación y de la recepción).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo" FROM motor2_app;
    GRANT SELECT, INSERT ON "NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo" TO motor2_app;
    GRANT UPDATE ("anuladaEn", "anuladaPorId", "motivoAnulacion", "recibidaEnAdministracionEn") ON "NotaCreditoProveedor" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo" FROM motor2_plataforma;
  END IF;
END
$$;
