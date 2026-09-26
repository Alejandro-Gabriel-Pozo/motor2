-- Cliente con descuento, continuación (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 3). Todo ADITIVO y NULLABLE:
-- ninguna fila existente cambia.
--
-- Operacion.clienteId (RESTRICT): agrupa el Kardex por cliente (no reusa Operacion.proveedorId a propósito — ver el docstring en
-- schema.prisma). MovimientoStock.precioListaUnitario: precio de LISTA de la fila VENTA, SOLO cuando difiere de lo cobrado
-- (`precioPorUnidadStock` de esa misma fila); sin FK, es un simple Decimal(14,2).
--
-- Generada con `prisma migrate dev --create-only` y revisada a mano contra el CUIDADO CONOCIDO del proyecto (Operacion_motivoId_fkey /
-- Operacion_destinoId_fkey: `migrate dev` puede degradar de más un RESTRICT existente a SET NULL por una deriva previa entre schema y
-- base, sin relación con este cambio) — no apareció ninguna sentencia ajena, así que no hubo nada que sacar.

-- AlterTable
ALTER TABLE "MovimientoStock" ADD COLUMN     "precioListaUnitario" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Operacion" ADD COLUMN     "clienteId" TEXT;

-- AddForeignKey
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
