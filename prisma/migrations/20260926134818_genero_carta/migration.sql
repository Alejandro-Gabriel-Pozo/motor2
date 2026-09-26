-- AlterTable
ALTER TABLE "ContenidoCartaProducto" ADD COLUMN     "generoCartaId" TEXT;

-- AlterTable
ALTER TABLE "ItemAgrupadoCarta" ADD COLUMN     "generoCartaId" TEXT;

-- CreateTable
CREATE TABLE "GeneroCarta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneroCarta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneroCarta_nombre_key" ON "GeneroCarta"("nombre");

-- CreateIndex
CREATE INDEX "GeneroCarta_activo_orden_idx" ON "GeneroCarta"("activo", "orden");

-- CreateIndex
CREATE INDEX "ContenidoCartaProducto_generoCartaId_idx" ON "ContenidoCartaProducto"("generoCartaId");

-- CreateIndex
CREATE INDEX "ItemAgrupadoCarta_generoCartaId_idx" ON "ItemAgrupadoCarta"("generoCartaId");

-- AddForeignKey
-- NOTA (docs/plan-genero-carta-2026-09-26.md): esta migración NO toca Operacion_motivoId_fkey / Operacion_destinoId_fkey.
-- `prisma migrate dev` las quiso re-crear con ON DELETE SET NULL (la deriva ya documentada en
-- 20260925152432_pos_tomar_pedido: RESTRICT real en la base desde 20260923143350_motivos_merma_consumo_catalogo, SET NULL
-- implícito en schema.prisma por no declarar onDelete en una relación opcional) — se sacaron esas dos líneas a mano de este
-- archivo para no romper en silencio ON DELETE RESTRICT de Operacion.motivoId/destinoId (lo exige
-- test/movimientos/motivos.test.ts: un motivo ya usado no se puede borrar). Esta migración es puramente aditiva para la carta.
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_generoCartaId_fkey" FOREIGN KEY ("generoCartaId") REFERENCES "GeneroCarta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_generoCartaId_fkey" FOREIGN KEY ("generoCartaId") REFERENCES "GeneroCarta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
