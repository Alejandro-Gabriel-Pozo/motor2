-- Arrastre de redondeo por fracción de venta (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md) — ver el docstring de
-- MovimientoStock.cantidadExacta en schema.prisma para la fórmula completa. Columna nullable, SIN default y SIN backfill (el
-- arreglo es solo hacia adelante: la deuda de cualquier producto antes de este cambio es 0). Sin FK ni índice nuevo: escrita a mano
-- con `--create-only` y revisada contra `psql \d+` para confirmar que no trae de más ninguna de las dos sentencias de deriva ya
-- documentadas en 20260925152432_pos_tomar_pedido / 20260926020130_movimiento_stock_sustituye_a_producto (DROP/ADD de
-- Operacion_motivoId_fkey / Operacion_destinoId_fkey, RESTRICT en la base, SET NULL implícito en el esquema) — no aplica acá.

-- AlterTable
ALTER TABLE "MovimientoStock" ADD COLUMN     "cantidadExacta" DECIMAL(20,8);
