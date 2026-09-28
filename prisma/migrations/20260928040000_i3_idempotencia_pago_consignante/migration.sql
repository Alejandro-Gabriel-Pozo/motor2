-- AlterTable
ALTER TABLE "PagoConsignante" ADD COLUMN     "claveIdempotencia" TEXT,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "resultadoMensaje" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PagoConsignante_claveIdempotencia_key" ON "PagoConsignante"("claveIdempotencia");
