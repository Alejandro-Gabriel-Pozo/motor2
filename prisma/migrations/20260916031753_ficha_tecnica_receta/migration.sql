-- AlterTable
ALTER TABLE "RecetaVersion" ADD COLUMN     "comentarios" TEXT,
ADD COLUMN     "equipamientoNecesario" TEXT,
ADD COLUMN     "notasAdicionales" TEXT,
ADD COLUMN     "presentacionEmplatado" TEXT,
ADD COLUMN     "racionTamano" DECIMAL(14,4),
ADD COLUMN     "racionUnidadId" TEXT,
ADD COLUMN     "racionesCantidad" INTEGER,
ADD COLUMN     "rendimientoCantidad" DECIMAL(14,4),
ADD COLUMN     "rendimientoUnidadId" TEXT,
ADD COLUMN     "tiempoCoccionMinutos" INTEGER,
ADD COLUMN     "tiempoPreparacionMinutos" INTEGER;

-- CreateTable
CREATE TABLE "RecetaPaso" (
    "id" TEXT NOT NULL,
    "recetaVersionId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre" TEXT,
    "instruccion" TEXT NOT NULL,
    "minutos" INTEGER,

    CONSTRAINT "RecetaPaso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecetaPasoIngrediente" (
    "id" TEXT NOT NULL,
    "recetaPasoId" TEXT NOT NULL,
    "recetaIngredienteId" TEXT NOT NULL,

    CONSTRAINT "RecetaPasoIngrediente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecetaPaso_recetaVersionId_idx" ON "RecetaPaso"("recetaVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RecetaPasoIngrediente_recetaPasoId_recetaIngredienteId_key" ON "RecetaPasoIngrediente"("recetaPasoId", "recetaIngredienteId");

-- AddForeignKey
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_rendimientoUnidadId_fkey" FOREIGN KEY ("rendimientoUnidadId") REFERENCES "Unidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_racionUnidadId_fkey" FOREIGN KEY ("racionUnidadId") REFERENCES "Unidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaPaso" ADD CONSTRAINT "RecetaPaso_recetaVersionId_fkey" FOREIGN KEY ("recetaVersionId") REFERENCES "RecetaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaPasoIngrediente" ADD CONSTRAINT "RecetaPasoIngrediente_recetaPasoId_fkey" FOREIGN KEY ("recetaPasoId") REFERENCES "RecetaPaso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaPasoIngrediente" ADD CONSTRAINT "RecetaPasoIngrediente_recetaIngredienteId_fkey" FOREIGN KEY ("recetaIngredienteId") REFERENCES "RecetaIngrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
