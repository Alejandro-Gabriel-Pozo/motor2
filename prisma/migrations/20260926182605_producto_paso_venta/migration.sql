-- Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): Producto.pasoVenta, puramente aditivo y NULLABLE (null =
-- comportamiento actual, sin cambios; sin backfill). Generada con `prisma migrate dev --create-only`. Se SACARON a mano dos pares
-- de sentencias ajenas a este cambio que Prisma agregó por la misma deriva ya documentada en 20260925152432_pos_tomar_pedido /
-- 20260926020130_movimiento_stock_sustituye_a_producto (Operacion_motivoId_fkey / Operacion_destinoId_fkey: RESTRICT en la base
-- desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el esquema): no se tocan acá.

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "pasoVenta" DECIMAL(14,4);
