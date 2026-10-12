-- Paquete 3, M3b (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la FACTURA DE PROVEEDOR como documento de la EMPRESA (ADR-029).
-- Tres tablas nuevas — `FacturaProveedor` (la cabecera), `FacturaProveedorRenglon` (lo comprado) y `FacturaProveedorSucursal` (la parte de cada sucursal) — y una columna nueva en el Kardex,
-- `MovimientoStock.facturaProveedorRenglonId` (de qué renglón de factura salió una línea de compra).
--
-- POR QUÉ: hoy una compra es UNA `Operacion` COMPRA por línea y de UNA sola sucursal; no existe «la factura» como cosa. Una factura que se reparte entre sucursales (FR2.2/FR2.3) o que carga una persona
-- y reparte otra (P7=b, «pendiente de reparto») necesita una cabecera que no pertenezca a ninguna sucursal: quien paga es la empresa. Por eso la cabecera y el renglón son DE EMPRESA (RLS `aislamiento_empresa`,
-- sin FK a `Sucursal`: con una FK a `Sucursal` la regla R3 de `test/arquitectura/alcance-de-sucursal.test.ts` la volvería «de sucursal» y las partes de otras sucursales no verían su propia cabecera) y la
-- parte de cada sucursal es `PROPIA` (las políticas de sucursal van en la migración siguiente, M3c). El vínculo con el Kardex va por `FacturaProveedorSucursal.operacionId` (única, opcional) y no se toca `Operacion`.
--
-- ÍNDICES SIN `CONCURRENTLY` (ADR-029): Prisma corre este archivo entero en UNA transacción y `CREATE INDEX CONCURRENTLY` no puede correr ahí. Las tablas nuevas nacen vacías y ningún código las lee ni escribe
-- hasta la Etapa C; el único índice sobre una tabla existente (`MovimientoStock`) cae sobre 0 filas en la base real (medido el 2026-10-11). Precedentes: 20260924150903_pos_mesas_cuentas y 20260929110000_indice_compras_por_producto.
-- Si antes de aplicar `MovimientoStock` supera el umbral de docs/deploy-con-migraciones.md, se parte el índice en un archivo aparte de UNA sola sentencia (ahí sí `CONCURRENTLY`); no es el caso hoy.
-- Las restricciones nuevas de `MovimientoStock` (FK y CHECK) se agregan sin `NOT VALID` porque la columna nace en NULL: aplicar con `SET lock_timeout = '5s'` en la conexión del dueño (precedente M-9).
--
-- UNICIDAD DEL NÚMERO: la decide un ÍNDICE ÚNICO PARCIAL en la base, no una lectura previa (`FacturaProveedor_unica_vigente_key`): dos cargas simultáneas del mismo número de factura del mismo proveedor, y gana una
-- (la otra recibe 23505). Vale solo para las NO anuladas, y abarca las pendientes de reparto (una pendiente RESERVA su número, D2). La letra entra en la clave cuando se conoce (D5): `COALESCE(letra, '')`.
-- Prisma no declara índices parciales: el índice vive solo acá (como `Operacion_factura_unica_vigente_key`) y `src/core/movimientos/factura-unica.ts` reconocerá su nombre en la Etapa C.
--
-- SOLO SE AGREGA, y el dinero no se corrige (D4): `motor2_app` tiene SELECT e INSERT en las tres tablas, NUNCA DELETE. En `FacturaProveedor` el UPDATE es POR COLUMNA y solo de dos grupos: (1) el estado y la
-- anulación (`estado`, `confirmadaEn`, `confirmadaPorId`, `anuladaEn`, `anuladaPorId`, `resultadoMensaje`) y (2) la lista cerrada de datos que IDENTIFICAN la factura (proveedor, número, letra, detalle, fecha del
-- comprobante, recepción y datos de pago declarados), como la corrección de K1b. `importeTotal`, `fecha`, `origen`, `condicionPago`, la clave de idempotencia y todo el renglón NO tienen UPDATE en la base: un error de
-- importe se anula y se vuelve a cargar (o va una nota de crédito). `motor2_plataforma` no toca nada de esto. Sin `@updatedAt` en el esquema (rompería el privilegio por columna).
--
-- Que los porcentajes declarados de las partes sumen 10000, que la sucursal de la parte sea la de su `Operacion` y que la suma de los renglones sea el total de la cabecera NO se pueden expresar sin un trigger
-- ni leyendo otras filas: los valida el caso de uso (Etapa C) y una consulta de coherencia del chequeo posterior (docs/deploy-con-migraciones.md). El `porcentajeDeclaradoBp` es la INTENCIÓN de quien carga y
-- NUNCA se usa para atribuir dinero: la atribución sale del dinero de cada parte.
--
-- Los CHECK de `FacturaProveedorRenglon` (`..._naturaleza_chk` y `..._pareo_mercaderia_chk`) llevan nombre fijo: M4 los borra y los vuelve a crear para sumar la naturaleza `SIN_STOCK`.
-- ADITIVA: el código anterior no lee ni escribe nada de esto (`MovimientoStock.facturaProveedorRenglonId` queda en NULL), así que sigue andando sobre la base nueva. NO se rellena nada (el relleno de las compras viejas
-- es una medición previa y, solo si diera más de 0, un script aparte con su propia autorización).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016101000_factura_proveedor`). Bajar ANTES M3c. DESTRUCTIVA si ya hay facturas.

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- La cabecera
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "FacturaProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "proveedorId" TEXT NOT NULL,
    "nroFactura" TEXT,
    "nroFacturaNormalizado" TEXT,
    "letra" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaComprobante" DATE,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "confirmadaEn" TIMESTAMP(3),
    "confirmadaPorId" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'CARGA',
    "condicionPago" TEXT NOT NULL DEFAULT 'CONTADO_PAGADA',
    "recibidaEnAdministracionEn" DATE,
    "fechaPagoDeclarada" DATE,
    "medioPagoDeclarado" TEXT,
    "detalleLibre" TEXT,
    "claveIdempotencia" TEXT,
    "payloadHash" TEXT,
    "resultadoMensaje" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorId" TEXT,

    CONSTRAINT "FacturaProveedor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacturaProveedor_empresaId_id_key" ON "FacturaProveedor"("empresaId", "id");
CREATE UNIQUE INDEX "FacturaProveedor_claveIdempotencia_key" ON "FacturaProveedor"("claveIdempotencia");
CREATE INDEX "FacturaProveedor_empresaId_proveedorId_fecha_idx" ON "FacturaProveedor"("empresaId", "proveedorId", "fecha");

-- La unicidad del número: un solo comprobante VIGENTE (no anulado, pendiente o confirmado) por proveedor, número normalizado y letra (D5: la letra entra en la clave cuando se conoce; sin letra, '').
CREATE UNIQUE INDEX "FacturaProveedor_unica_vigente_key"
  ON "FacturaProveedor" ("empresaId", "proveedorId", COALESCE("letra", ''), "nroFacturaNormalizado")
  WHERE "nroFacturaNormalizado" IS NOT NULL AND "anuladaEn" IS NULL;

ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_confirmadaPorId_fkey" FOREIGN KEY ("confirmadaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El número tal cual se tecleó y su clave normalizada van juntos (los dos nulos o los dos con texto).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_nro_pareo_chk"
  CHECK (
    ("nroFactura" IS NULL AND "nroFacturaNormalizado" IS NULL)
    OR ("nroFactura" IS NOT NULL AND "nroFacturaNormalizado" IS NOT NULL AND length(btrim("nroFactura")) > 0 AND length(btrim("nroFacturaNormalizado")) > 0)
  );
-- La letra del comprobante, cuando se conoce.
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_letra_chk" CHECK ("letra" IS NULL OR "letra" IN ('A', 'B', 'C', 'E', 'M', 'X'));
-- El total no es negativo (con IVA incluido).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_importe_total_no_negativo_chk" CHECK ("importeTotal" >= 0);
-- El estado, y la confirmación (cuándo y quién) si y solo si está CONFIRMADA: una pendiente de reparto todavía no la confirmó nadie.
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_estado_chk" CHECK ("estado" IN ('PENDIENTE_DE_REPARTO', 'CONFIRMADA'));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_confirmacion_coherente_chk"
  CHECK (("estado" = 'CONFIRMADA') = ("confirmadaEn" IS NOT NULL) AND ("confirmadaEn" IS NULL) = ("confirmadaPorId" IS NULL));
-- De dónde salió, y solo lo cargado por una persona puede quedar pendiente (lo migrado nace confirmado).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_origen_chk" CHECK ("origen" IN ('CARGA', 'MIGRACION'));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_pendiente_solo_carga_chk" CHECK ("origen" = 'CARGA' OR "estado" = 'CONFIRMADA');
-- Contado pagada es la única condición de pago por ahora (C6/C30); los datos de pago declarados solo tienen sentido con ella (C31).
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_condicion_pago_chk" CHECK ("condicionPago" IN ('CONTADO_PAGADA'));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_medio_pago_chk" CHECK ("medioPagoDeclarado" IS NULL OR "medioPagoDeclarado" IN ('TRANSFERENCIA', 'EFECTIVO', 'CHEQUE', 'TARJETA', 'OTRO'));
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_pago_declarado_solo_contado_chk"
  CHECK (("fechaPagoDeclarada" IS NULL AND "medioPagoDeclarado" IS NULL) OR "condicionPago" = 'CONTADO_PAGADA');
-- La clave de idempotencia y la huella del pedido van juntas.
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_idempotencia_pareo_chk" CHECK (("claveIdempotencia" IS NULL) = ("payloadHash" IS NULL));
-- La anulación (cuándo y quién) va junta.
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_anulacion_pareo_chk" CHECK (("anuladaEn" IS NULL) = ("anuladaPorId" IS NULL));

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- El renglón (lo comprado)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "FacturaProveedorRenglon" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "naturaleza" TEXT NOT NULL DEFAULT 'MERCADERIA',
    "descripcion" TEXT,
    "productoId" TEXT,
    "cantidadStock" DECIMAL(14,4),
    "precioPorUnidadStock" DECIMAL(14,4),
    "loteVencimiento" DATE,
    "detalle" TEXT,
    "precioTotal" DECIMAL(14,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaProveedorRenglon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacturaProveedorRenglon_empresaId_id_key" ON "FacturaProveedorRenglon"("empresaId", "id");
CREATE UNIQUE INDEX "FacturaProveedorRenglon_facturaProveedorId_orden_key" ON "FacturaProveedorRenglon"("facturaProveedorId", "orden");

ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_orden_chk" CHECK ("orden" >= 1);
-- La naturaleza del renglón. M4 amplía esta lista (SIN_STOCK) borrando y volviendo a crear el CHECK con este mismo nombre.
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_naturaleza_chk" CHECK ("naturaleza" IN ('MERCADERIA'));
-- Los campos de mercadería van en pareo con la naturaleza: un renglón de MERCADERIA tiene producto, cantidad, precio por unidad de stock y el texto de conversión; cualquier otra naturaleza, ninguno.
-- M4 reemplaza este CHECK (mismo nombre) por el pareo de las dos naturalezas.
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_pareo_mercaderia_chk"
  CHECK (
    ("naturaleza" = 'MERCADERIA' AND "productoId" IS NOT NULL AND "cantidadStock" IS NOT NULL AND "precioPorUnidadStock" IS NOT NULL AND "detalle" IS NOT NULL)
    OR ("naturaleza" <> 'MERCADERIA' AND "productoId" IS NULL AND "cantidadStock" IS NULL AND "precioPorUnidadStock" IS NULL AND "detalle" IS NULL AND "loteVencimiento" IS NULL)
  );
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_cantidad_positiva_chk" CHECK ("cantidadStock" IS NULL OR "cantidadStock" > 0);
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_precio_unidad_no_negativo_chk" CHECK ("precioPorUnidadStock" IS NULL OR "precioPorUnidadStock" >= 0);
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_precio_total_no_negativo_chk" CHECK ("precioTotal" >= 0);

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- La parte de cada sucursal
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE "FacturaProveedorSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "facturaProveedorId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "porcentajeDeclaradoBp" INTEGER NOT NULL,
    "operacionId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturaProveedorSucursal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacturaProveedorSucursal_empresaId_id_key" ON "FacturaProveedorSucursal"("empresaId", "id");
-- Una sola parte por (factura, sucursal).
CREATE UNIQUE INDEX "FacturaProveedorSucursal_facturaProveedorId_sucursalId_key" ON "FacturaProveedorSucursal"("facturaProveedorId", "sucursalId");
-- Una `Operacion` es la parte de a lo sumo UNA factura (varias partes pueden quedar sin operación: los gastos de M4).
CREATE UNIQUE INDEX "FacturaProveedorSucursal_empresaId_operacionId_key" ON "FacturaProveedorSucursal"("empresaId", "operacionId");
CREATE INDEX "FacturaProveedorSucursal_sucursalId_idx" ON "FacturaProveedorSucursal"("sucursalId");

ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_empresaId_facturaProveedorId_fkey" FOREIGN KEY ("empresaId", "facturaProveedorId") REFERENCES "FacturaProveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_empresaId_operacionId_fkey" FOREIGN KEY ("empresaId", "operacionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El porcentaje declarado, en puntos básicos (10000 = 100 %): de 0,01 % a 100 %.
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_porcentaje_chk" CHECK ("porcentajeDeclaradoBp" BETWEEN 1 AND 10000);

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- El Kardex: de qué renglón de factura salió una línea de compra
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "MovimientoStock" ADD COLUMN "facturaProveedorRenglonId" TEXT;
CREATE INDEX "MovimientoStock_facturaProveedorRenglonId_idx" ON "MovimientoStock"("facturaProveedorRenglonId");
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_facturaProveedorRenglonId_fkey" FOREIGN KEY ("empresaId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Solo una línea de COMPRA sale de un renglón de factura (los AJUSTE de una anulación quedan sin renglón).
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_renglon_solo_compra_chk" CHECK ("facturaProveedorRenglonId" IS NULL OR "proceso" = 'COMPRA');

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- RLS por empresa y privilegios
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE "FacturaProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "FacturaProveedorRenglon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedorRenglon"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "FacturaProveedorSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FacturaProveedorSucursal"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Los privilegios por defecto le dan DML completo a `motor2_app` sobre las tablas nuevas: se le quitan TODOS y se le
-- devuelve lo mínimo. Solo se agrega (SELECT e INSERT, nunca DELETE); el UPDATE de `FacturaProveedor` es por columna y solo de las que cambian de estado o corrigen datos de identificación.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal" FROM motor2_app;
    GRANT SELECT, INSERT ON "FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal" TO motor2_app;
    GRANT UPDATE ("estado", "confirmadaEn", "confirmadaPorId", "anuladaEn", "anuladaPorId", "resultadoMensaje",
                  "proveedorId", "nroFactura", "nroFacturaNormalizado", "letra", "detalleLibre", "fechaComprobante", "recibidaEnAdministracionEn", "fechaPagoDeclarada", "medioPagoDeclarado")
      ON "FacturaProveedor" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal" FROM motor2_plataforma;
  END IF;
END
$$;
