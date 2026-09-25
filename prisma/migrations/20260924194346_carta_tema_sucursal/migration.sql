-- Tema visual de la carta pública (docs/plan-tema-carta-2026-09-24.md, paso M1): 1 tabla nueva, TemaCartaSucursal, 1:1 con
-- Sucursal (FK RESTRICT: las sucursales nunca se borran). Solo CREATE TABLE + 1 índice único (sucursalId) + 1 FK. SIN backfill
-- a propósito (decisión D4): una fila ausente significa "la carta sigue con la tab Config de la sheet del tenant". `valores` es
-- la primera columna Json del schema: las claves de SiteConfig del catálogo CLAVES_TEMA_V1 (src/core/carta/tema.ts).

-- CreateTable
CREATE TABLE "TemaCartaSucursal" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "valores" JSONB NOT NULL DEFAULT '{}',
    "aplicarEnCarta" BOOLEAN NOT NULL DEFAULT false,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemaCartaSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemaCartaSucursal_sucursalId_key" ON "TemaCartaSucursal"("sucursalId");

-- AddForeignKey
ALTER TABLE "TemaCartaSucursal" ADD CONSTRAINT "TemaCartaSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
