-- AlterTable
ALTER TABLE "Sucursal" ADD COLUMN     "promocionesHabilitadas" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PromocionProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PromocionProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromocionProducto_sucursalId_productoId_key" ON "PromocionProducto"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
