-- Seccion.sirveDeRespaldoEnVentas (docs/plan-seccion-habitual-stock-2026-09-25.md, B5). ADITIVA: columna nueva con DEFAULT true,
-- así que TODAS las secciones existentes y futuras siguen sirviendo de respaldo automático (nadie tiene que configurar nada).
-- Generada con `prisma migrate dev --create-only`. Se SACARON a mano cuatro sentencias ajenas a este cambio que Prisma agregó por la
-- deriva previa ya documentada en 20260925152432_pos_tomar_pedido (DROP/ADD de Operacion_motivoId_fkey y Operacion_destinoId_fkey:
-- RESTRICT en la base desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el esquema): no se tocan acá.

-- AlterTable
ALTER TABLE "Seccion" ADD COLUMN     "sirveDeRespaldoEnVentas" BOOLEAN NOT NULL DEFAULT true;
