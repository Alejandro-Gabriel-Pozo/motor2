-- AlterEnum
ALTER TYPE "Proceso" ADD VALUE 'RECLASIFICACION';

-- CreateTable
CREATE TABLE "StockMinimoProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "seccionId" TEXT,
    "minimo" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "StockMinimoProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockMinimoProducto_productoId_seccionId_key" ON "StockMinimoProducto"("productoId", "seccionId");

-- AddForeignKey
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_seccionId_fkey" FOREIGN KEY ("seccionId") REFERENCES "Seccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índice único que Prisma no puede declarar (ver docs/plan-migracion.md,
-- Pendiente): como máximo una fila "global" (seccionId IS NULL) por
-- sucursal+producto — mismo criterio que CapacidadSucursal.sucursalId NULL.
CREATE UNIQUE INDEX "StockMinimoProducto_sucursalId_productoId_global_key"
  ON "StockMinimoProducto" ("sucursalId", "productoId")
  WHERE "seccionId" IS NULL;
