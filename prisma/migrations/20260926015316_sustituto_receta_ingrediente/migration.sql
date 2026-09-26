-- Sustitutos de insumo por línea de receta (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D1/paso 4). ADITIVA: tabla nueva,
-- ninguna fila existente cambia. Generada con `prisma migrate dev --create-only`. Se SACARON a mano dos sentencias ajenas a este
-- cambio que Prisma agregó por la deriva ya documentada en 20260925152432_pos_tomar_pedido (DROP/ADD de Operacion_motivoId_fkey y
-- Operacion_destinoId_fkey: RESTRICT en la base desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el
-- esquema): no se tocan acá.

-- CreateTable
CREATE TABLE "SustitutoRecetaIngrediente" (
    "id" TEXT NOT NULL,
    "recetaIngredienteId" TEXT NOT NULL,
    "insumoSustitutoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    CONSTRAINT "SustitutoRecetaIngrediente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SustitutoRecetaIngrediente_ingrediente_insumo_key" ON "SustitutoRecetaIngrediente"("recetaIngredienteId", "insumoSustitutoId");
CREATE UNIQUE INDEX "SustitutoRecetaIngrediente_recetaIngredienteId_orden_key" ON "SustitutoRecetaIngrediente"("recetaIngredienteId", "orden");
CREATE INDEX "SustitutoRecetaIngrediente_insumoSustitutoId_idx" ON "SustitutoRecetaIngrediente"("insumoSustitutoId");
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_recetaIngredienteId_fkey" FOREIGN KEY ("recetaIngredienteId") REFERENCES "RecetaIngrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_insumoSustitutoId_fkey" FOREIGN KEY ("insumoSustitutoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
