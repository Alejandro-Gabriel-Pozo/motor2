-- Cliente con % de descuento fijo (Task #14, docs/plan-clientes-descuento-2026-09-26.md, puntos 1-2). Catálogo CENTRAL (sin
-- sucursalId), mismo criterio que Proveedor. Todo ADITIVO: Cuenta.clienteId/descuentoPorcentaje son NULLABLE — ninguna cuenta
-- existente cambia.
--
-- Cuenta.clienteId (RESTRICT): cliente asignado a la cuenta (asignarClienteACuenta, cualquier mozo — D3). Cuenta.descuentoPorcentaje:
-- SNAPSHOT del % del cliente, congelado al asignarlo (D7) — nunca se vuelve a leer Cliente.descuentoPorcentaje para una cuenta ya
-- asignada.
--
-- Generada con `prisma migrate dev --create-only` y revisada a mano (CUIDADO CONOCIDO del proyecto: `migrate dev` puede agregar de
-- más un DROP/ADD de otra FK RESTRICT no relacionada con este cambio — no fue el caso acá, pero se revisó igual).

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descuentoPorcentaje" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_nombre_key" ON "Cliente"("nombre");

-- AlterTable
ALTER TABLE "Cuenta" ADD COLUMN     "clienteId" TEXT,
ADD COLUMN     "descuentoPorcentaje" DECIMAL(5,2);

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
