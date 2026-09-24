-- Carta (docs/plan-carta-catalogo-2026-09-24.md, paso M1): 4 tablas nuevas,
-- solo CREATE TABLE + índices + FKs (RESTRICT, como el resto del catálogo).
-- SIN backfill a propósito: por la decisión D3 una fila ausente en
-- ContenidoCartaProducto significa "no se muestra en la carta".

-- CreateTable
CREATE TABLE "SeccionCarta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SeccionCarta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaSeccionCarta" (
    "id" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "seccionCartaId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoriaSeccionCarta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContenidoCartaProducto" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "visibleEnCarta" BOOLEAN NOT NULL DEFAULT false,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "especial" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContenidoCartaProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCarta" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "seccionCartaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(14,2) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCarta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeccionCarta_nombre_key" ON "SeccionCarta"("nombre");

-- CreateIndex
CREATE INDEX "SeccionCarta_activa_orden_idx" ON "SeccionCarta"("activa", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaSeccionCarta_categoriaId_key" ON "CategoriaSeccionCarta"("categoriaId");

-- CreateIndex
CREATE INDEX "CategoriaSeccionCarta_seccionCartaId_idx" ON "CategoriaSeccionCarta"("seccionCartaId");

-- CreateIndex
CREATE UNIQUE INDEX "ContenidoCartaProducto_productoId_key" ON "ContenidoCartaProducto"("productoId");

-- CreateIndex
CREATE INDEX "PromoCarta_sucursalId_activa_idx" ON "PromoCarta"("sucursalId", "activa");

-- CreateIndex
CREATE INDEX "PromoCarta_seccionCartaId_idx" ON "PromoCarta"("seccionCartaId");

-- AddForeignKey
ALTER TABLE "CategoriaSeccionCarta" ADD CONSTRAINT "CategoriaSeccionCarta_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProducto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaSeccionCarta" ADD CONSTRAINT "CategoriaSeccionCarta_seccionCartaId_fkey" FOREIGN KEY ("seccionCartaId") REFERENCES "SeccionCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_seccionCartaId_fkey" FOREIGN KEY ("seccionCartaId") REFERENCES "SeccionCarta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
