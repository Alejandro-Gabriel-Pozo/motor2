-- Rendimiento por sucursal (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 3a): tabla nueva, ADITIVA, sin
-- relleno inicial. Generada con `prisma migrate dev --create-only`. Se SACARON a mano cuatro sentencias ajenas a este cambio
-- que Prisma agregó por la misma deriva previa entre schema.prisma y la base que ya documentó
-- 20260925152432_pos_tomar_pedido (Operacion_motivoId_fkey / Operacion_destinoId_fkey: RESTRICT en la base desde
-- 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el esquema) — no se tocan acá.

-- CreateTable
CREATE TABLE "RendimientoLocalIngrediente" (
    "id" TEXT NOT NULL,
    "recetaIngredienteId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4),
    "mermaPorcentaje" DECIMAL(6,2),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RendimientoLocalIngrediente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RendimientoLocalIngrediente_sucursalId_idx" ON "RendimientoLocalIngrediente"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "RendimientoLocalIngrediente_recetaIngredienteId_sucursalId_key" ON "RendimientoLocalIngrediente"("recetaIngredienteId", "sucursalId");

-- AddForeignKey
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_recetaIngredienteId_fkey" FOREIGN KEY ("recetaIngredienteId") REFERENCES "RecetaIngrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
