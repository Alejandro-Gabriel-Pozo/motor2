-- POS: tomar pedido (docs/plan-tomar-pedido-2026-09-25.md, paso 1). Todo ADITIVO y NULLABLE: ninguna fila existente cambia.
-- - Cuenta.cerradaPorId: quién cerró la cuenta (cerrarCuenta / liberarMesa).
-- - CuentaItem.creadoPorId: quién cargó el ítem (o quién anuló, en una fila espejo).
-- - CuentaItem.anulaAItemId + motivoAnulacion: fila ESPEJO que anula (parcial o totalmente) un ítem ya enviado a cocina; el original
--   nunca se edita ni se borra (RESTRICT). Invariantes (espejo ⇒ cantidad < 0, mismo numeroEnvio, motivo no vacío) en la aplicación.
-- - CuentaItem.operacionId: la Operacion VENTA que registró el ítem al cerrar la cuenta (RESTRICT).
-- Generada con `prisma migrate dev --create-only`. Se SACARON a mano dos sentencias ajenas a este cambio que Prisma agregó por una
-- deriva previa entre schema.prisma y la base (Operacion_motivoId_fkey / Operacion_destinoId_fkey: RESTRICT en la base desde
-- 20260923143350_motivos_merma_consumo_catalogo, SET NULL implícito en el esquema): no se tocan acá.

-- AlterTable
ALTER TABLE "Cuenta" ADD COLUMN     "cerradaPorId" TEXT;

-- AlterTable
ALTER TABLE "CuentaItem" ADD COLUMN     "anulaAItemId" TEXT,
ADD COLUMN     "creadoPorId" TEXT,
ADD COLUMN     "motivoAnulacion" TEXT,
ADD COLUMN     "operacionId" TEXT;

-- CreateIndex
CREATE INDEX "CuentaItem_anulaAItemId_idx" ON "CuentaItem"("anulaAItemId");

-- CreateIndex
CREATE INDEX "CuentaItem_operacionId_idx" ON "CuentaItem"("operacionId");

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_anulaAItemId_fkey" FOREIGN KEY ("anulaAItemId") REFERENCES "CuentaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_operacionId_fkey" FOREIGN KEY ("operacionId") REFERENCES "Operacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
