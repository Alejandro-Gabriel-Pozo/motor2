-- AlterTable
ALTER TABLE "ConteoFisico" ADD COLUMN     "claveIdempotencia" TEXT,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "resultadoMensaje" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ConteoFisico_claveIdempotencia_key" ON "ConteoFisico"("claveIdempotencia");
