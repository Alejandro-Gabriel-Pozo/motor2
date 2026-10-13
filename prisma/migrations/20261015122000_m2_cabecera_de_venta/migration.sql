-- M2-3 (Paquete 2; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la CABECERA de venta (`Venta`, con su canal MESA/MOSTRADOR) y `Operacion.ventaId`.
--
-- POR QUÉ: hoy hay una `Operacion` VENTA por línea vendida y nada las agrupa en «una venta» (el mostrador no tiene ninguna cabecera; en el salón la cuenta las agrupa, pero la cuenta es del POS, no de la venta).
-- `Venta` es la cabecera: quién, cuándo, dónde, por qué canal y cuánto se cobró. Es una CABECERA y NO la fuente de la plata: la plata sigue saliendo del Kardex (`MovimientoStock`); `importeTotal` es una
-- COPIA del total cobrado al confirmar, que nunca se modifica. Se llama `canal` y no `origen` porque `origen` ya es, en el código, la sección de la que sale el stock.
--
-- SOLO SE AGREGA: `motor2_app` tiene SELECT e INSERT sobre `Venta`, nunca UPDATE ni DELETE (igual que `AgregadoDeCuenta`); `motor2_plataforma` no la toca. No tiene `anuladaEn`: el estado de una venta se
-- calcula de sus operaciones. Una mesa tiene a lo sumo UNA cabecera (`UNIQUE (empresaId, cuentaId)`): es la idempotencia natural del cierre de la cuenta (cerrarlo dos veces no escribe dos). No lleva clave de
-- idempotencia propia (la del mostrador sigue en su primera `Operacion`, en la misma transacción) ni cliente (ya está en `Operacion`).
--
-- Tabla de empresa (RLS `aislamiento_empresa`) con alcance de sucursal PROPIA: las políticas por sucursal las agrega la migración M2-4 (20261015123000_m2_rls_sucursal_venta), que requiere ESTA y B1.
-- Las claves foráneas son COMPUESTAS (empresaId, x) hacia Sucursal, Cuenta y, desde `Operacion`, hacia `Venta`: la empresa de las dos puntas coincide por construcción. Que la sucursal de la línea y la de su
-- cabecera coincidan NO lo puede controlar la base (una clave foránea entre tablas de empresa lleva exactamente (empresaId, x)): lo controla la aplicación (Etapa C).
--
-- ADITIVA: la tabla nueva no la escribe ni la lee nada de `src/` todavía (Etapa C) y `Operacion.ventaId` queda en NULL, así que el código anterior sigue andando sobre la base nueva. NO se rellena nada acá
-- (las cabeceras de las mesas ya cerradas son un relleno aparte, con su propia autorización). CHECK `NOT VALID` + `VALIDATE` en el mismo script (precedente 20261002160000); con la tabla vacía y `ventaId` en NULL
-- no pueden fallar.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261015122000_m2_cabecera_de_venta`). Bajar ANTES M2-4. DESTRUCTIVA si ya hay cabeceras:
-- se pierden el canal, la cuenta y el total copiado de cada venta (las líneas y el Kardex no se tocan).

CREATE TYPE "CanalDeVenta" AS ENUM ('MESA', 'MOSTRADOR');

CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "canal" "CanalDeVenta" NOT NULL,
    "cuentaId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Venta_sucursalId_fecha_idx" ON "Venta"("sucursalId", "fecha");
CREATE UNIQUE INDEX "Venta_empresaId_id_key" ON "Venta"("empresaId", "id");
CREATE UNIQUE INDEX "Venta_empresaId_cuentaId_key" ON "Venta"("empresaId", "cuentaId");

ALTER TABLE "Venta" ADD CONSTRAINT "Venta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una venta de MESA siempre tiene su cuenta, y una de MOSTRADOR nunca.
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_canal_y_cuenta_chk" CHECK (("canal" = 'MESA') = ("cuentaId" IS NOT NULL)) NOT VALID;
ALTER TABLE "Venta" VALIDATE CONSTRAINT "Venta_canal_y_cuenta_chk";

-- El total cobrado no es negativo (un total en cero es posible: una venta con descuento total).
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_importe_total_no_negativo_chk" CHECK ("importeTotal" >= 0) NOT VALID;
ALTER TABLE "Venta" VALIDATE CONSTRAINT "Venta_importe_total_no_negativo_chk";

-- RLS por empresa, igual que el resto de las tablas de empresa.
ALTER TABLE "Venta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Venta"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- La línea de venta apunta a su cabecera. Solo una VENTA tiene cabecera.
ALTER TABLE "Operacion" ADD COLUMN "ventaId" TEXT;
CREATE INDEX "Operacion_ventaId_idx" ON "Operacion"("ventaId");
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_ventaId_fkey" FOREIGN KEY ("empresaId", "ventaId") REFERENCES "Venta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_venta_solo_en_ventas_chk" CHECK ("ventaId" IS NULL OR proceso = 'VENTA') NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_venta_solo_en_ventas_chk";

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Solo se agrega: sin UPDATE ni DELETE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "Venta" FROM motor2_app;
    GRANT SELECT, INSERT ON "Venta" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "Venta" FROM motor2_plataforma;
  END IF;
END
$$;
