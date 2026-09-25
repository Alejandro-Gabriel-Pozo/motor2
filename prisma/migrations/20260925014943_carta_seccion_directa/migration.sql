/*
  Warnings:

  - You are about to drop the column `imagenUrl` on the `ContenidoCartaProducto` table. All the data in the column will be lost.
  - You are about to drop the column `categoriaId` on the `ItemAgrupadoCarta` table. All the data in the column will be lost.
  - You are about to drop the column `imagenUrl` on the `ItemAgrupadoCarta` table. All the data in the column will be lost.
  - You are about to drop the `CategoriaSeccionCarta` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `seccionCartaId` to the `ItemAgrupadoCarta` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CategoriaSeccionCarta" DROP CONSTRAINT "CategoriaSeccionCarta_categoriaId_fkey";

-- DropForeignKey
ALTER TABLE "CategoriaSeccionCarta" DROP CONSTRAINT "CategoriaSeccionCarta_seccionCartaId_fkey";

-- DropForeignKey
ALTER TABLE "ItemAgrupadoCarta" DROP CONSTRAINT "ItemAgrupadoCarta_categoriaId_fkey";

-- DropIndex
DROP INDEX "ItemAgrupadoCarta_categoriaId_idx";

-- AlterTable
ALTER TABLE "ContenidoCartaProducto" DROP COLUMN "imagenUrl",
ADD COLUMN     "seccionCartaId" TEXT;

-- AlterTable
ALTER TABLE "ItemAgrupadoCarta" DROP COLUMN "categoriaId",
DROP COLUMN "imagenUrl",
ADD COLUMN     "seccionCartaId" TEXT NOT NULL;

-- DropTable
DROP TABLE "CategoriaSeccionCarta";

-- CreateIndex
CREATE INDEX "ContenidoCartaProducto_seccionCartaId_idx" ON "ContenidoCartaProducto"("seccionCartaId");

-- CreateIndex
CREATE INDEX "ItemAgrupadoCarta_seccionCartaId_idx" ON "ItemAgrupadoCarta"("seccionCartaId");

-- AddForeignKey
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_seccionCartaId_fkey" FOREIGN KEY ("seccionCartaId") REFERENCES "SeccionCarta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_seccionCartaId_fkey" FOREIGN KEY ("seccionCartaId") REFERENCES "SeccionCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
