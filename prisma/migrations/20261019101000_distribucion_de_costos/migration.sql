-- Paquete 5, M7.2 (Etapa B; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la DISTRIBUCIÓN POR VERSIONES de la imputación de un gasto entre los centros de costos de un plan.
-- Ancla = `ImputacionDeGasto (empresaId, id)`, el único que M4.3 dejó reservado para esto. No toca ninguna tabla existente, no cambia importes y no distribuye mercadería (solo existen imputaciones de renglones SIN_STOCK).
--
-- Dos tablas HEREDADAS de la sucursal (la versión por `imputacionDeGastoId`, la línea por la versión; sin `sucursalId` propio): sus políticas de alcance por sucursal las agrega la migración 20261019102000 (M7.3). Cada (imputación, plan) tiene versiones
-- 1, 2, 3...; la VIGENTE es la de `numero` mayor (derivada, nunca un flag ni un UPDATE); sin ninguna versión el estado es «sin asignar». Corregir es agregar una versión nueva con motivo (obligatorio desde la 2). El único (imputación, plan, numero)
-- elige UNA ganadora entre versiones simultáneas; la clave de idempotencia es única global (ADR-028) y se guarda el mensaje para reproducirlo (I3). Cabecera y líneas van en la MISMA transacción.
--
-- La base NO suma filas (no hay disparadores): que Σ porcentajeBp = 10000 y que Σ importes e IVA computable sean los de la imputación lo valida la Etapa C y la consulta de coherencia de docs/deploy-con-migraciones.md. La línea y su centro son del plan
-- de la versión (claves foráneas compuestas de tres columnas). Dinero DECIMAL(14,2) con IVA incluido, repartido en dos pasos con `repartirImporte`; porcentajes en puntos básicos enteros. SOLO se agrega: la app tiene SELECT e INSERT, nunca UPDATE ni DELETE.
-- Sin CONCURRENTLY (tablas nuevas y vacías); al aplicar conviene `SET lock_timeout = '5s'` (las claves foráneas toman un instante SHARE ROW EXCLUSIVE sobre Empresa, User e ImputacionDeGasto). Requiere 20261019100000 (planes y centros).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay filas. Se baja ANTES que M7.1 y DESPUÉS de M7.3.

CREATE TABLE "DistribucionCostoVersion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "imputacionDeGastoId" TEXT NOT NULL,
    "planDeCostosId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "motivo" TEXT,
    "claveIdempotencia" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultadoMensaje" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistribucionCostoVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistribucionCostoVersion_empresaId_id_key" ON "DistribucionCostoVersion"("empresaId", "id");
-- (empresaId, id, planDeCostosId): destino de la clave foránea de la línea (la línea es del plan de su versión).
CREATE UNIQUE INDEX "DistribucionCostoVersion_empresaId_id_planDeCostosId_key" ON "DistribucionCostoVersion"("empresaId", "id", "planDeCostosId");
-- Una sola ganadora por (imputación, plan, numero); nombre explícito porque Prisma truncaría el derivado y se perdería «numero».
CREATE UNIQUE INDEX "DistribucionCostoVersion_imputacion_plan_numero_key" ON "DistribucionCostoVersion"("imputacionDeGastoId", "planDeCostosId", "numero");
CREATE UNIQUE INDEX "DistribucionCostoVersion_claveIdempotencia_key" ON "DistribucionCostoVersion"("claveIdempotencia");
CREATE INDEX "DistribucionCostoVersion_planDeCostosId_idx" ON "DistribucionCostoVersion"("planDeCostosId");
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey" FOREIGN KEY ("empresaId", "imputacionDeGastoId") REFERENCES "ImputacionDeGasto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_empresaId_planDeCostosId_fkey" FOREIGN KEY ("empresaId", "planDeCostosId") REFERENCES "PlanDeCostos"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_numero_chk" CHECK ("numero" >= 1);
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_motivo_chk" CHECK ("motivo" IS NULL OR ("motivo" ~ '\S' AND char_length("motivo") <= 200));
ALTER TABLE "DistribucionCostoVersion" ADD CONSTRAINT "DistribucionCostoVersion_motivo_en_correccion_chk" CHECK ("numero" = 1 OR "motivo" IS NOT NULL);

CREATE TABLE "DistribucionCostoLinea" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "distribucionCostoVersionId" TEXT NOT NULL,
    "planDeCostosId" TEXT NOT NULL,
    "centroDeCostosId" TEXT NOT NULL,
    "porcentajeBp" INTEGER NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "importeIvaComputable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT "DistribucionCostoLinea_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistribucionCostoLinea_empresaId_id_key" ON "DistribucionCostoLinea"("empresaId", "id");
-- Un centro una sola vez por versión.
CREATE UNIQUE INDEX "DistribucionCostoLinea_version_centro_key" ON "DistribucionCostoLinea"("distribucionCostoVersionId", "centroDeCostosId");
CREATE INDEX "DistribucionCostoLinea_centroDeCostosId_idx" ON "DistribucionCostoLinea"("centroDeCostosId");
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Las dos claves foráneas de tres columnas (los nombres, los que Prisma deriva y trunca a 63 caracteres): la línea es del plan de su versión, y su centro también.
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_empresaId_distribucionCostoVersionI_fkey"
  FOREIGN KEY ("empresaId", "distribucionCostoVersionId", "planDeCostosId") REFERENCES "DistribucionCostoVersion"("empresaId", "id", "planDeCostosId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_empresaId_planDeCostosId_centroDeCo_fkey"
  FOREIGN KEY ("empresaId", "planDeCostosId", "centroDeCostosId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_porcentaje_chk" CHECK ("porcentajeBp" BETWEEN 1 AND 10000);
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_importe_chk" CHECK ("importe" >= 0);
ALTER TABLE "DistribucionCostoLinea" ADD CONSTRAINT "DistribucionCostoLinea_iva_computable_chk" CHECK ("importeIvaComputable" >= 0 AND "importeIvaComputable" <= "importe");

ALTER TABLE "DistribucionCostoVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "DistribucionCostoVersion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "DistribucionCostoLinea" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "DistribucionCostoLinea"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "DistribucionCostoVersion", "DistribucionCostoLinea" FROM motor2_app;
    GRANT SELECT, INSERT ON "DistribucionCostoVersion", "DistribucionCostoLinea" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "DistribucionCostoVersion", "DistribucionCostoLinea" FROM motor2_plataforma;
  END IF;
END
$$;
