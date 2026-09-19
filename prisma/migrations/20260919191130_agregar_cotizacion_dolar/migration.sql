-- CreateTable
CREATE TABLE "CotizacionDolar" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "fuente" TEXT NOT NULL,
    "compra" DECIMAL(12,4),
    "venta" DECIMAL(12,4) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotizacionDolar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CotizacionDolar_fecha_fuente_key" ON "CotizacionDolar"("fecha", "fuente");
