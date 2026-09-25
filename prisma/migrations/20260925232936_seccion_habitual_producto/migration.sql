-- Sección habitual de un PV por sucursal (docs/plan-seccion-habitual-stock-2026-09-25.md). ADITIVA: tabla nueva, ninguna fila
-- existente cambia, sin backfill (fila ausente = sin preferencia = resolución automática pura en el cierre del POS).
-- Generada con `prisma migrate dev --create-only`. Se SACARON a mano cuatro sentencias ajenas a este cambio que Prisma agregó por la
-- deriva previa ya documentada en 20260925152432_pos_tomar_pedido (DROP/ADD de Operacion_motivoId_fkey y Operacion_destinoId_fkey:
-- RESTRICT en la base desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el esquema): no se tocan acá.

-- CreateTable
CREATE TABLE "SeccionHabitualProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "seccionId" TEXT NOT NULL,

    CONSTRAINT "SeccionHabitualProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeccionHabitualProducto_sucursalId_productoId_key" ON "SeccionHabitualProducto"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_seccionId_fkey" FOREIGN KEY ("seccionId") REFERENCES "Seccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
