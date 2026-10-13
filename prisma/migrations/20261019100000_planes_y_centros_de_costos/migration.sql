-- Paquete 5, M7.1 (Etapa B; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): los PLANES y CENTROS DE COSTOS de la empresa (unidades de negocio) y en qué sucursales APLICA cada plan.
-- Solo el modelo de datos: no toca ninguna tabla existente, no cambia importes y no siembra ningún plan ni centro (los códigos de las unidades de negocio los carga el dueño; ninguno se fija en código).
--
-- `PlanDeCostos` y `CentroDeCostos` son DE LA EMPRESA (sin `sucursalId`, solo RLS por empresa): el mismo código vale en todas las sucursales. `PlanDeCostosSucursal` es PROPIA de la sucursal (su `sucursalId` es NOT NULL con clave foránea);
-- las 4 políticas de alcance por sucursal de esta última las agrega la migración 20261019102000 (M7.3). ADR-009, familia «optin»: un plan sin fila en la sucursal, o con `aplica = false`, NO aplica ahí (lo resuelve el embudo `planDeCostosAplica`).
--
-- El código de un plan y de un centro es fijo desde el alta (CHECK de formato, único por empresa, sin UPDATE); el nombre es único sin importar mayúsculas (por empresa en el plan, por plan en el centro). La app solo cambia `nombre` y `activo`
-- (y `aplica`), por columna; no borra nada: la baja es desactivar. `centroPadreId` queda SIEMPRE NULL en la v1 (CHECK); la clave foránea de tres columnas ya obliga a que, cuando se habiliten los sub-centros, el padre sea del mismo plan (ADR-031).
-- Toda unicidad y todo formato los decide la base (dos altas simultáneas dejan una sola: 23505). Sin CONCURRENTLY: las tablas nacen vacías; al aplicar conviene `SET lock_timeout = '5s'` (las claves foráneas toman un instante SHARE ROW EXCLUSIVE sobre Empresa y Sucursal).
-- Requiere el rol motor2_app si existe (los GRANT son condicionales) y la función app_empresa_actual() (default de empresaId).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay filas. Se baja DESPUÉS de M7.4, M7.3 y M7.2.

CREATE TABLE "PlanDeCostos" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanDeCostos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanDeCostos_empresaId_id_key" ON "PlanDeCostos"("empresaId", "id");
CREATE UNIQUE INDEX "PlanDeCostos_empresaId_codigo_key" ON "PlanDeCostos"("empresaId", "codigo");
CREATE UNIQUE INDEX "PlanDeCostos_empresaId_nombre_key" ON "PlanDeCostos"("empresaId", "nombre");
CREATE UNIQUE INDEX "PlanDeCostos_nombre_lower_key" ON "PlanDeCostos" ("empresaId", lower("nombre"));
ALTER TABLE "PlanDeCostos" ADD CONSTRAINT "PlanDeCostos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanDeCostos" ADD CONSTRAINT "PlanDeCostos_codigo_chk" CHECK ("codigo" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "PlanDeCostos" ADD CONSTRAINT "PlanDeCostos_nombre_chk" CHECK ("nombre" ~ '\S' AND length("nombre") <= 120);

CREATE TABLE "CentroDeCostos" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "planDeCostosId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "centroPadreId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CentroDeCostos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentroDeCostos_empresaId_id_key" ON "CentroDeCostos"("empresaId", "id");
CREATE UNIQUE INDEX "CentroDeCostos_empresaId_planDeCostosId_id_key" ON "CentroDeCostos"("empresaId", "planDeCostosId", "id");
CREATE UNIQUE INDEX "CentroDeCostos_empresaId_codigo_key" ON "CentroDeCostos"("empresaId", "codigo");
CREATE UNIQUE INDEX "CentroDeCostos_empresaId_planDeCostosId_nombre_key" ON "CentroDeCostos"("empresaId", "planDeCostosId", "nombre");
CREATE UNIQUE INDEX "CentroDeCostos_nombre_lower_key" ON "CentroDeCostos" ("empresaId", "planDeCostosId", lower("nombre"));
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_empresaId_planDeCostosId_fkey" FOREIGN KEY ("empresaId", "planDeCostosId") REFERENCES "PlanDeCostos"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_empresaId_planDeCostosId_centroPadreId_fkey"
  FOREIGN KEY ("empresaId", "planDeCostosId", "centroPadreId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_codigo_chk" CHECK ("codigo" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_nombre_chk" CHECK ("nombre" ~ '\S' AND length("nombre") <= 120);
ALTER TABLE "CentroDeCostos" ADD CONSTRAINT "CentroDeCostos_sin_padre_chk" CHECK ("centroPadreId" IS NULL);

CREATE TABLE "PlanDeCostosSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "planDeCostosId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "aplica" BOOLEAN NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanDeCostosSucursal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanDeCostosSucursal_empresaId_id_key" ON "PlanDeCostosSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "PlanDeCostosSucursal_planDeCostosId_sucursalId_key" ON "PlanDeCostosSucursal"("planDeCostosId", "sucursalId");
CREATE INDEX "PlanDeCostosSucursal_sucursalId_idx" ON "PlanDeCostosSucursal"("sucursalId");
ALTER TABLE "PlanDeCostosSucursal" ADD CONSTRAINT "PlanDeCostosSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanDeCostosSucursal" ADD CONSTRAINT "PlanDeCostosSucursal_empresaId_planDeCostosId_fkey" FOREIGN KEY ("empresaId", "planDeCostosId") REFERENCES "PlanDeCostos"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanDeCostosSucursal" ADD CONSTRAINT "PlanDeCostosSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanDeCostos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PlanDeCostos"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "CentroDeCostos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CentroDeCostos"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PlanDeCostosSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PlanDeCostosSucursal"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PlanDeCostos", "CentroDeCostos", "PlanDeCostosSucursal" FROM motor2_app;
    GRANT SELECT, INSERT ON "PlanDeCostos", "CentroDeCostos", "PlanDeCostosSucursal" TO motor2_app;
    GRANT UPDATE ("nombre", "activo") ON "PlanDeCostos" TO motor2_app;
    GRANT UPDATE ("nombre", "activo") ON "CentroDeCostos" TO motor2_app;
    GRANT UPDATE ("aplica") ON "PlanDeCostosSucursal" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PlanDeCostos", "CentroDeCostos", "PlanDeCostosSucursal" FROM motor2_plataforma;
  END IF;
END
$$;
