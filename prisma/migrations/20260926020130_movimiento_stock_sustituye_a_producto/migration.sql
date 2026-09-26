-- Marca de sustitución en el Kardex (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D6/paso 5). Columna nullable sin default,
-- sin backfill. Generada con `prisma migrate dev --create-only`. Se SACARON a mano dos sentencias ajenas a este cambio que Prisma
-- agregó por la deriva ya documentada en 20260925152432_pos_tomar_pedido (DROP/ADD de Operacion_motivoId_fkey y
-- Operacion_destinoId_fkey: RESTRICT en la base desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el
-- esquema): no se tocan acá.

-- AlterTable
ALTER TABLE "MovimientoStock" ADD COLUMN "sustituyeAProductoId" TEXT;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_sustituyeAProductoId_fkey" FOREIGN KEY ("sustituyeAProductoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
