-- CreateTable
CREATE TABLE "PagoConsignante" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "importe" DECIMAL(14,4) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "usuarioId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoConsignante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PagoConsignante_sucursalId_proveedorId_idx" ON "PagoConsignante"("sucursalId", "proveedorId");

-- AddForeignKey
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
