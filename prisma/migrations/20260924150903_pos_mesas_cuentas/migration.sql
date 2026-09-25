-- POS: mapa de mesas del salón (docs/plan-mapa-de-mesas-2026-09-24.md, paso 1). Mesa + Cuenta (la cuenta abierta de la mesa, NO la
-- comanda/KOT) + CuentaItem. El estado de la mesa no se persiste: se deriva de su Cuenta abierta (src/core/pos/mesas.ts).
-- Generada con `prisma migrate dev --create-only`; el índice único parcial del final va a mano (Prisma no sabe declararlo).

-- CreateTable
CREATE TABLE "Mesa" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cuenta" (
    "id" TEXT NOT NULL,
    "mesaId" TEXT NOT NULL,
    "abiertaPorId" TEXT NOT NULL,
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMP(3),

    CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaItem" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "precioUnitario" DECIMAL(14,2) NOT NULL,
    "numeroEnvio" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mesa_sucursalId_numero_key" ON "Mesa"("sucursalId", "numero");

-- CreateIndex
CREATE INDEX "Cuenta_mesaId_idx" ON "Cuenta"("mesaId");

-- CreateIndex
CREATE INDEX "CuentaItem_cuentaId_idx" ON "CuentaItem"("cuentaId");

-- AddForeignKey
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "Mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A lo sumo UNA cuenta abierta ("cerradaEn" IS NULL) por mesa: el estado de la mesa se deriva de ESA cuenta, así que dos abiertas a la
-- vez harían el estado ambiguo. Una mesa puede tener cualquier cantidad de cuentas ya cerradas (el historial). Índice parcial manual,
-- mismo criterio que 20260915034450_indices_manuales y 20260921230000_factura_unica_vigente. Sin CONCURRENTLY: la tabla es nueva y
-- está vacía, y así puede ir en el mismo archivo (y la misma transacción) que el CREATE TABLE.
CREATE UNIQUE INDEX "Cuenta_una_abierta_por_mesa_key" ON "Cuenta"("mesaId") WHERE "cerradaEn" IS NULL;
