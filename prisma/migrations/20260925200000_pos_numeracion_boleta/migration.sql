-- POS: numeración de la boleta de cierre (docs/plan-numeracion-boleta-2026-09-25.md). ADITIVA: una tabla nueva; ninguna fila existente
-- cambia. Control interno (guest check control), no comprobante fiscal: la boleta sigue diciendo «No válido como factura».
-- Cada fila es un EJEMPLAR impreso: número BASE secuencial por sucursal + ejemplar (1 = A). Una corrección es una fila nueva con el mismo
-- número, el ejemplar siguiente, corrigeAId → el ejemplar A y el motivo (criterio de CuentaItem.anulaAItemId). Sin backfill.

CREATE TABLE "EjemplarBoleta" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "ejemplar" INTEGER NOT NULL DEFAULT 1,
    "emitidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitidoPorId" TEXT NOT NULL,
    "corrigeAId" TEXT,
    "motivo" TEXT,
    CONSTRAINT "EjemplarBoleta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EjemplarBoleta_sucursalId_numero_ejemplar_key" ON "EjemplarBoleta"("sucursalId", "numero", "ejemplar");
CREATE UNIQUE INDEX "EjemplarBoleta_cuentaId_ejemplar_key" ON "EjemplarBoleta"("cuentaId", "ejemplar");
CREATE INDEX "EjemplarBoleta_corrigeAId_idx" ON "EjemplarBoleta"("corrigeAId");
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_emitidoPorId_fkey" FOREIGN KEY ("emitidoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_corrigeAId_fkey" FOREIGN KEY ("corrigeAId") REFERENCES "EjemplarBoleta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
