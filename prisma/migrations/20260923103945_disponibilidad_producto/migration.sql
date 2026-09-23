-- CreateTable
CREATE TABLE "DisponibilidadProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL,

    CONSTRAINT "DisponibilidadProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisponibilidadProducto_sucursalId_productoId_key" ON "DisponibilidadProducto"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: TODO producto × TODA sucursal, con el valor que tiene HOY el
-- booleano global. Preserva por construcción la equivalencia de la
-- decisión 1 ("inactivo en todas" ≡ el `activo: false` de hoy) y evita
-- que el catálogo entero desaparezca de todas las pantallas.
-- Se incluyen las sucursales con activo=false: una sucursal apagada se
-- puede volver a prender y su catálogo tiene que seguir ahí.
INSERT INTO "DisponibilidadProducto" ("id", "sucursalId", "productoId", "disponible")
SELECT gen_random_uuid()::text, s."id", p."id", p."activo"
FROM "Producto" p CROSS JOIN "Sucursal" s;
