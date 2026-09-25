-- Registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, paso M1): 1 tabla nueva,
-- SucursalPublica, 1:1 con Sucursal (FK RESTRICT: las sucursales nunca se borran). Solo CREATE TABLE +
-- 3 índices únicos (sucursalId, slug, dominio) + 1 FK. SIN backfill a propósito (decisión D3): una fila
-- ausente significa "esta sucursal no está en el registro de motor2" y la carta sigue usando la sheet.

-- CreateTable
CREATE TABLE "SucursalPublica" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "etiqueta" TEXT,
    "dominio" TEXT,
    "subtituloPortal" TEXT,
    "posX" DECIMAL(5,2),
    "posY" DECIMAL(5,2),
    "posW" DECIMAL(5,2),
    "posH" DECIMAL(5,2),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "publicada" BOOLEAN NOT NULL DEFAULT false,
    "menuDesdeMotor2" BOOLEAN NOT NULL DEFAULT false,
    "sheetId" TEXT,
    "sheetMenuNombre" TEXT NOT NULL DEFAULT 'Menu',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SucursalPublica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SucursalPublica_sucursalId_key" ON "SucursalPublica"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalPublica_slug_key" ON "SucursalPublica"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SucursalPublica_dominio_key" ON "SucursalPublica"("dominio");

-- AddForeignKey
ALTER TABLE "SucursalPublica" ADD CONSTRAINT "SucursalPublica_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
