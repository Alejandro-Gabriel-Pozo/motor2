-- Receta propia por sucursal (decisión del dueño, 2026-10-02; ADR-009, familia «override»; esquema autorizado expresamente). Hasta ahora toda
-- receta era central (de la empresa) y la sucursal solo la calibraba ingrediente por ingrediente (`RendimientoLocalIngrediente`). Ahora una sucursal
-- puede tener LA SUYA: versiones propias de la receta de un producto, que rigen en esa sucursal mientras `RecetaSucursal.habilitada`. Reversa: down.sql.
--
-- 1) `RecetaVersion.sucursalId` (NULL = central) y `basadaEnVersionId` (la central vigente en la que se basó una versión propia, para el aviso
--    «la central cambió»; sin FK: las versiones centrales son append-only).
-- 2) La numeración de `version` pasa a ser por (producto, sucursal): el UNIQUE (productoId, version) se reemplaza por DOS índices únicos
--    parciales (uno para la central, otro para las propias): un UNIQUE común trata NULL como distinto de NULL y dejaría duplicar la central.
-- 3) Tabla nueva `RecetaSucursal` (una fila por sucursal × producto con receta propia; `habilitada` = rige, o se volvió a la central).
--    Multiempresa como el resto: "empresaId" con default app_empresa_actual() y política aislamiento_empresa.

-- DropIndex
DROP INDEX "RecetaVersion_productoId_version_key";

-- AlterTable
ALTER TABLE "RecetaVersion" ADD COLUMN     "basadaEnVersionId" TEXT,
ADD COLUMN     "sucursalId" TEXT;

-- CreateIndex (a mano: Prisma no declara los índices parciales)
CREATE UNIQUE INDEX "RecetaVersion_productoId_version_central_key" ON "RecetaVersion"("productoId", "version") WHERE "sucursalId" IS NULL;
CREATE UNIQUE INDEX "RecetaVersion_productoId_sucursalId_version_propia_key" ON "RecetaVersion"("productoId", "sucursalId", "version") WHERE "sucursalId" IS NOT NULL;
CREATE INDEX "RecetaVersion_productoId_sucursalId_idx" ON "RecetaVersion"("productoId", "sucursalId");

-- CreateTable
CREATE TABLE "RecetaSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "habilitada" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RecetaSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecetaSucursal_sucursalId_productoId_key" ON "RecetaSucursal"("sucursalId", "productoId");
CREATE UNIQUE INDEX "RecetaSucursal_empresaId_id_key" ON "RecetaSucursal"("empresaId", "id");

-- AddForeignKey
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaSucursal" ADD CONSTRAINT "RecetaSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaSucursal" ADD CONSTRAINT "RecetaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaSucursal" ADD CONSTRAINT "RecetaSucursal_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aislamiento por empresa (RLS)
ALTER TABLE "RecetaSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Permisos para el rol de ejecución, si existe (los default privileges del dueño ya lo cubren; esto lo deja explícito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "RecetaSucursal" TO motor2_app;
  END IF;
END
$$;
