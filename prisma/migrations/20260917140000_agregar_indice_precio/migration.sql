-- CreateTable
CREATE TABLE "IndicePrecio" (
    "id" TEXT NOT NULL,
    "mes" DATE NOT NULL,
    "valor" DECIMAL(12,4) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndicePrecio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndicePrecio_mes_key" ON "IndicePrecio"("mes");
