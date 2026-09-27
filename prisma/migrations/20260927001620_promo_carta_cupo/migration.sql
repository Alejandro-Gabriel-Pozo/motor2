-- Generada con `prisma migrate dev --create-only` y revisada a mano contra el CUIDADO CONOCIDO del proyecto
-- (Operacion_motivoId_fkey / Operacion_destinoId_fkey / Operacion_clienteId_fkey / Cuenta_clienteId_fkey: `migrate dev`
-- puede degradar de más un RESTRICT existente a SET NULL por una deriva previa entre schema y base — ver
-- 20260926190100_operacion_movimiento_cliente_descuento y 20260925152432_pos_tomar_pedido). El DROP/ADD que Prisma generó
-- para esas 4 constraints (RESTRICT en la base, SET NULL implícito en el esquema, sin relación con este cambio) se
-- eliminó de este archivo a mano; se confirmó con `psql \d+ "Operacion"` / `\d+ "Cuenta"` que siguen en RESTRICT.

-- CreateTable
CREATE TABLE "PromoCartaCupo" (
    "id" TEXT NOT NULL,
    "promoCartaId" TEXT NOT NULL,
    "seccionCartaId" TEXT NOT NULL,
    "cantidadMinima" INTEGER NOT NULL DEFAULT 0,
    "cantidadMaxima" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PromoCartaCupo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCartaCupo_promoCartaId_seccionCartaId_key" ON "PromoCartaCupo"("promoCartaId", "seccionCartaId");

-- AddForeignKey
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_promoCartaId_fkey" FOREIGN KEY ("promoCartaId") REFERENCES "PromoCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_seccionCartaId_fkey" FOREIGN KEY ("seccionCartaId") REFERENCES "SeccionCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
