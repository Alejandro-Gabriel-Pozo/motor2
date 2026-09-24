-- CreateTable
CREATE TABLE "ItemAgrupadoCarta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "especial" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemAgrupadoCarta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpcionItemAgrupadoCarta" (
    "id" TEXT NOT NULL,
    "itemAgrupadoCartaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpcionItemAgrupadoCarta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemAgrupadoCarta_nombre_key" ON "ItemAgrupadoCarta"("nombre");

-- CreateIndex
CREATE INDEX "ItemAgrupadoCarta_categoriaId_idx" ON "ItemAgrupadoCarta"("categoriaId");

-- CreateIndex
CREATE INDEX "ItemAgrupadoCarta_activo_idx" ON "ItemAgrupadoCarta"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "OpcionItemAgrupadoCarta_productoId_key" ON "OpcionItemAgrupadoCarta"("productoId");

-- CreateIndex
CREATE INDEX "OpcionItemAgrupadoCarta_itemAgrupadoCartaId_idx" ON "OpcionItemAgrupadoCarta"("itemAgrupadoCartaId");

-- AddForeignKey
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProducto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_itemAgrupadoCartaId_fkey" FOREIGN KEY ("itemAgrupadoCartaId") REFERENCES "ItemAgrupadoCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
