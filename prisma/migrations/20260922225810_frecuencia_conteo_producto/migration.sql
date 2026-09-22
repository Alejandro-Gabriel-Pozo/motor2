-- CreateTable
CREATE TABLE "FrecuenciaConteoProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "frecuenciaDias" INTEGER NOT NULL,

    CONSTRAINT "FrecuenciaConteoProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FrecuenciaConteoProducto_sucursalId_productoId_key" ON "FrecuenciaConteoProducto"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
