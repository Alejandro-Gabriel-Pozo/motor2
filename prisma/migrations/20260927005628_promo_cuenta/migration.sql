-- Generada con `prisma migrate dev --create-only` y revisada a mano contra el CUIDADO CONOCIDO del proyecto
-- (Operacion_motivoId_fkey / Operacion_destinoId_fkey / Operacion_clienteId_fkey / Cuenta_clienteId_fkey: `migrate dev`
-- puede degradar de más un RESTRICT existente a SET NULL por una deriva previa entre schema y base — ver
-- 20260927001620_promo_carta_cupo, 20260926190100_operacion_movimiento_cliente_descuento). El DROP/ADD que Prisma volvió a
-- generar para esas 4 constraints se eliminó de este archivo a mano; se confirmó con `psql \d+` que siguen en RESTRICT.
--
-- Además, `Operacion.promoCuentaId` y `CuentaItem.promoCuentaId` (nuevos, Task #16, docs/plan-promo-combo-2026-09-26.md) tienen
-- que quedar RESTRICT (como toda referencia histórica de este proyecto, mismo criterio que `clienteId`), no el
-- "ON DELETE SET NULL" que Prisma generó por defecto para una FK opcional sin `onDelete` explícito en el schema (el mismo
-- patrón que ya existe para `Operacion.clienteId`, `Cuenta.clienteId`, etc. — el schema no declara `onDelete: Restrict`
-- porque Prisma Migrate lo reescribiría a SET NULL en la próxima corrida igual; la base manda, no el diff automático).

-- AlterTable
ALTER TABLE "CuentaItem" ADD COLUMN     "precioCartaUnitario" DECIMAL(14,2),
ADD COLUMN     "promoCuentaId" TEXT;

-- AlterTable
ALTER TABLE "Operacion" ADD COLUMN     "promoCuentaId" TEXT;

-- CreateTable
CREATE TABLE "PromoCuenta" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "promoCartaId" TEXT NOT NULL,
    "precio" DECIMAL(14,2) NOT NULL,
    "titulo" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoCuenta_cuentaId_idx" ON "PromoCuenta"("cuentaId");

-- CreateIndex
CREATE INDEX "CuentaItem_promoCuentaId_idx" ON "CuentaItem"("promoCuentaId");

-- CreateIndex
CREATE INDEX "Operacion_promoCuentaId_idx" ON "Operacion"("promoCuentaId");

-- AddForeignKey
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_promoCuentaId_fkey" FOREIGN KEY ("promoCuentaId") REFERENCES "PromoCuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_promoCartaId_fkey" FOREIGN KEY ("promoCartaId") REFERENCES "PromoCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_promoCuentaId_fkey" FOREIGN KEY ("promoCuentaId") REFERENCES "PromoCuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
