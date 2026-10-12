-- M2-2 (Paquete 2; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el ORIGEN de una devolución a proveedor.
--
-- POR QUÉ: hoy una devolución a proveedor (línea DEVOLUCION_PROVEEDOR del Kardex) no dice de qué compra sale: no hay forma de controlar el tope (no devolver más de lo comprado) ni de
-- mostrar «esta compra ya se devolvió en parte». `devuelveAMovimientoId` apunta a la línea de COMPRA que se devuelve.
--
-- ADITIVA: una columna NULLABLE, en NULL; nada de `src/` la lee ni la escribe todavía (Etapa C). NO es única a propósito: una línea de compra puede devolverse en varias partes, y el tope lo controla la
-- aplicación. No se rellena nada (las devoluciones anteriores a M2 quedan sin origen: no se puede reconstruir). La columna se escribe solo en el INSERT de la línea nueva: el Kardex solo agrega.
-- La clave foránea es COMPUESTA (empresaId, devuelveAMovimientoId) → MovimientoStock(empresaId, id), como las demás entre tablas de empresa. Que la línea apuntada sea una COMPRA vigente de la misma sucursal
-- lo controla la aplicación (Etapa C). CHECK `NOT VALID` + `VALIDATE` en el mismo script (precedente 20261002160000); con la columna en NULL no puede fallar. Idempotente.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261015121000_m2_movimiento_devuelve_a`). DESTRUCTIVA si ya hay datos: se pierde el origen de las devoluciones.

ALTER TABLE "MovimientoStock" ADD COLUMN IF NOT EXISTS "devuelveAMovimientoId" TEXT;

CREATE INDEX IF NOT EXISTS "MovimientoStock_devuelveAMovimientoId_idx" ON "MovimientoStock"("devuelveAMovimientoId");

ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_empresaId_devuelveAMovimientoId_fkey";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_devuelveAMovimientoId_fkey" FOREIGN KEY ("empresaId", "devuelveAMovimientoId") REFERENCES "MovimientoStock"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El origen solo lo lleva una devolución a proveedor y nunca es la línea misma.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_devuelve_solo_devolucion_proveedor_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_devuelve_solo_devolucion_proveedor_chk" CHECK (
  "devuelveAMovimientoId" IS NULL OR (proceso = 'DEVOLUCION_PROVEEDOR' AND "devuelveAMovimientoId" <> id)
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_devuelve_solo_devolucion_proveedor_chk";
