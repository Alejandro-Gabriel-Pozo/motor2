-- AlterTable
ALTER TABLE "Operacion" ADD COLUMN     "claveIdempotencia" TEXT,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "resultadoMensaje" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Operacion_claveIdempotencia_key" ON "Operacion"("claveIdempotencia");

