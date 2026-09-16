-- AlterTable
ALTER TABLE "Operacion" ADD COLUMN     "anuladaEn" TIMESTAMP(3),
ADD COLUMN     "anuladaPorId" TEXT;

-- AddForeignKey
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
