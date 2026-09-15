-- CreateEnum
CREATE TYPE "IniciadoPorTraspaso" AS ENUM ('ORIGEN', 'DESTINO');

-- CreateEnum
CREATE TYPE "EstadoTraspaso" AS ENUM ('SOLICITADA', 'ENVIADA', 'ACEPTADA', 'RECHAZADA_ORIGEN', 'RECHAZADA_DESTINO', 'CERRADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Proceso" ADD VALUE 'TRANSFERENCIA_SALIDA_SUCURSAL';
ALTER TYPE "Proceso" ADD VALUE 'TRANSFERENCIA_ENTRADA_SUCURSAL';
ALTER TYPE "Proceso" ADD VALUE 'REINGRESO_TRANSFERENCIA_SUCURSAL';

-- AlterTable
ALTER TABLE "MovimientoStock" ADD COLUMN     "traspasoSucursalId" TEXT;

-- CreateTable
CREATE TABLE "TraspasoSucursal" (
    "id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origenSucursalId" TEXT NOT NULL,
    "destinoSucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "seccionOrigenId" TEXT,
    "seccionDestinoId" TEXT,
    "iniciadoPor" "IniciadoPorTraspaso" NOT NULL,
    "estado" "EstadoTraspaso" NOT NULL DEFAULT 'SOLICITADA',
    "creadoPorId" TEXT NOT NULL,
    "detalle" TEXT,
    "fechaDecisionOrigen" TIMESTAMP(3),
    "decididoPorOrigenId" TEXT,
    "motivoRechazoOrigen" TEXT,
    "fechaDecisionDestino" TIMESTAMP(3),
    "decididoPorDestinoId" TEXT,
    "motivoRechazoDestino" TEXT,
    "fechaCierre" TIMESTAMP(3),
    "cerradoPorId" TEXT,

    CONSTRAINT "TraspasoSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TraspasoSucursal_origenSucursalId_estado_idx" ON "TraspasoSucursal"("origenSucursalId", "estado");

-- CreateIndex
CREATE INDEX "TraspasoSucursal_destinoSucursalId_estado_idx" ON "TraspasoSucursal"("destinoSucursalId", "estado");

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_traspasoSucursalId_fkey" FOREIGN KEY ("traspasoSucursalId") REFERENCES "TraspasoSucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_origenSucursalId_fkey" FOREIGN KEY ("origenSucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_destinoSucursalId_fkey" FOREIGN KEY ("destinoSucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_seccionOrigenId_fkey" FOREIGN KEY ("seccionOrigenId") REFERENCES "Seccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_seccionDestinoId_fkey" FOREIGN KEY ("seccionDestinoId") REFERENCES "Seccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_decididoPorOrigenId_fkey" FOREIGN KEY ("decididoPorOrigenId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_decididoPorDestinoId_fkey" FOREIGN KEY ("decididoPorDestinoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
