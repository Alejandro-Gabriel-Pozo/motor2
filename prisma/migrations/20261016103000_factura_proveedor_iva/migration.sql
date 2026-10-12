-- Paquete 3, M3d (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el IVA y los tributos de la factura de proveedor (C33/C38, D1) y la PERILLA de IVA de la empresa.
--
-- PERILLA (supuesto declarado del dueño, 2026-10-12): `Empresa.llevaIvaDeCompras`, BOOLEAN NOT NULL DEFAULT false. APAGADA (el valor de todas las empresas hoy): la factura de proveedor NO exige neto, IVA ni alícuota; todo se carga
-- con IVA incluido (`importeTotal`, `precioTotal`), igual que las compras de hoy. PRENDIDA: la factura exige el desglose según su letra y lo que se desglosa alimenta el IVA computable. La carga la hace la PLATAFORMA, nunca la
-- propia empresa (igual que `condicionIva`; `test/arquitectura/politica-de-empresa-solo-plataforma.test.ts` lo vigila). Las VENTAS no dependen de la perilla.
--
-- LA BASE NO LEE `Empresa` DESDE UN CHECK: por eso las columnas de desglose son NULLABLES y NO hay ningún CHECK de obligatoriedad que dependa de la perilla (ni de la letra). Lo que sí está en la base son los CHECK de COHERENCIA
-- cuando hay valores: neto + IVA = total del renglón EXACTO en centavos, alícuota de la lista cerrada (`ALICUOTAS_IVA` de src/core/fiscal/iva.ts), importes no negativos, IVA computable entre 0 y el IVA, y los tributos mayores que cero.
-- QUÉ EXIGE CADA CASO (perilla prendida, según la letra) lo hace la Etapa C en el SERVIDOR, que sí puede leer la empresa; queda anotado en ADR-029.
--
-- Cabecera: `condicionIvaEmpresa` (la condición de la empresa frente al IVA al momento de la carga, copiada de `Empresa.condicionIva`; NULL = no se declaró), `importeNeto` e `importeIva` (totales del comprobante; NULL = no se desglosó).
-- Renglón: `alicuotaIva`, `importeNeto`, `importeIva` (NULL = no se desglosó) e `importeIvaComputable` (NOT NULL DEFAULT 0: el IVA que la empresa puede computar; 0 con la perilla apagada, con letra C o si la empresa no es Responsable
-- Inscripto, y neutro para las sumas de M4: Σ del computable de las imputaciones = computable del renglón). Tributos (`FacturaProveedorTributo`): percepciones e impuestos que trae la factura además del IVA; cuelgan de la cabecera,
-- son DE EMPRESA y solo se agregan. El total del comprobante (`importeTotal`) es lo que se debe pagar: la suma de los renglones más los tributos (lo valida el caso de uso; la base no suma filas).
--
-- SOLO SE AGREGA, y el dinero no se corrige (D4): las columnas nuevas de la cabecera y del renglón NO tienen UPDATE (el privilegio de UPDATE de la cabecera es por columna y no las incluye); `FacturaProveedorTributo` tiene
-- SELECT e INSERT, nunca UPDATE ni DELETE. `motor2_plataforma` no toca nada de esto salvo `Empresa` (donde ya tiene UPDATE de tabla, que cubre la perilla).
--
-- ADITIVA: el código anterior no lee ni escribe nada de esto (`Empresa` se lee con `select` explícito o con todas las columnas, y la nueva trae su default), así que sigue andando sobre la base nueva. Las tablas de la factura están vacías
-- (ningún caso de uso las escribe hasta la Etapa C), así que ningún CHECK nuevo puede fallar al agregarse; `ADD COLUMN` con default constante solo toca el catálogo. Aplicar sin tráfico y con `lock_timeout` corto.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016103000_factura_proveedor_iva`). DESTRUCTIVA si ya hay desgloses, tributos o empresas con la perilla prendida.

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- La perilla de la empresa
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "Empresa" ADD COLUMN "llevaIvaDeCompras" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- La cabecera: condición de IVA de la empresa y totales del desglose
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "FacturaProveedor"
  ADD COLUMN "condicionIvaEmpresa" TEXT,
  ADD COLUMN "importeNeto" DECIMAL(14,2),
  ADD COLUMN "importeIva" DECIMAL(14,2);

-- La condición es una de las tres de `CONDICIONES_IVA` (la misma lista que `Empresa_condicionIva_check`).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_condicion_iva_empresa_chk"
  CHECK ("condicionIvaEmpresa" IS NULL OR "condicionIvaEmpresa" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'));
-- El neto y el IVA del comprobante van juntos (los dos o ninguno), no son negativos y, con el IVA, no superan el total (el resto son tributos, no gravado y exento).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_desglose_pareo_chk" CHECK (("importeNeto" IS NULL) = ("importeIva" IS NULL));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_desglose_no_negativo_chk" CHECK (("importeNeto" IS NULL OR "importeNeto" >= 0) AND ("importeIva" IS NULL OR "importeIva" >= 0));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_desglose_dentro_del_total_chk" CHECK ("importeNeto" IS NULL OR "importeNeto" + "importeIva" <= "importeTotal");

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- El renglón: alícuota, neto, IVA e IVA computable
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "FacturaProveedorRenglon"
  ADD COLUMN "alicuotaIva" TEXT,
  ADD COLUMN "importeNeto" DECIMAL(14,2),
  ADD COLUMN "importeIva" DECIMAL(14,2),
  ADD COLUMN "importeIvaComputable" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- La alícuota es un código de la lista cerrada `ALICUOTAS_IVA` (la misma que `Producto_alicuotaIvaCompra_check`).
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_alicuota_iva_chk"
  CHECK ("alicuotaIva" IS NULL OR "alicuotaIva" IN ('IVA_0', 'IVA_2_5', 'IVA_5', 'IVA_10_5', 'IVA_21', 'IVA_27', 'EXENTO', 'NO_GRAVADO'));
-- El neto y el IVA del renglón van juntos (los dos o ninguno) y no son negativos.
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_desglose_pareo_chk" CHECK (("importeNeto" IS NULL) = ("importeIva" IS NULL));
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_desglose_no_negativo_chk" CHECK (("importeNeto" IS NULL OR "importeNeto" >= 0) AND ("importeIva" IS NULL OR "importeIva" >= 0));
-- Neto + IVA = total del renglón, EXACTO en centavos (el total del renglón es con IVA incluido).
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_neto_mas_iva_chk" CHECK ("importeNeto" IS NULL OR "importeNeto" + "importeIva" = "precioTotal");
-- Con una alícuota que no genera IVA (0 %, exento, no gravado) el IVA discriminado es cero.
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_alicuota_sin_iva_chk"
  CHECK ("alicuotaIva" IS NULL OR "importeIva" IS NULL OR "alicuotaIva" NOT IN ('IVA_0', 'EXENTO', 'NO_GRAVADO') OR "importeIva" = 0);
-- El IVA computable es el que la empresa puede tomar: de cero al IVA del renglón (sin IVA discriminado, cero).
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_iva_computable_chk" CHECK ("importeIvaComputable" >= 0 AND "importeIvaComputable" <= COALESCE("importeIva", 0));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Los tributos de la factura (C38)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "FacturaProveedorTributo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "importe" DECIMAL(14,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaProveedorTributo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacturaProveedorTributo_empresaId_id_key" ON "FacturaProveedorTributo"("empresaId", "id");
CREATE INDEX "FacturaProveedorTributo_facturaProveedorId_idx" ON "FacturaProveedorTributo"("facturaProveedorId");

ALTER TABLE "FacturaProveedorTributo" ADD CONSTRAINT "FacturaProveedorTributo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorTributo" ADD CONSTRAINT "FacturaProveedorTributo_empresaId_facturaProveedorId_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El tipo del tributo, de lista cerrada (ampliarla es ampliar este CHECK), y un importe mayor que cero (un tributo en cero no es un tributo).
ALTER TABLE "FacturaProveedorTributo" ADD CONSTRAINT "FacturaProveedorTributo_tipo_chk"
  CHECK ("tipo" IN ('PERCEPCION_IVA', 'PERCEPCION_IIBB', 'PERCEPCION_GANANCIAS', 'IMPUESTO_INTERNO', 'IMPUESTO_MUNICIPAL', 'OTRO'));
ALTER TABLE "FacturaProveedorTributo" ADD CONSTRAINT "FacturaProveedorTributo_importe_positivo_chk" CHECK ("importe" > 0);

ALTER TABLE "FacturaProveedorTributo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedorTributo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Solo se agrega: sin UPDATE ni DELETE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "FacturaProveedorTributo" FROM motor2_app;
    GRANT SELECT, INSERT ON "FacturaProveedorTributo" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "FacturaProveedorTributo" FROM motor2_plataforma;
  END IF;
END
$$;
