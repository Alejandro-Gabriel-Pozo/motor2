-- Reversa de 20261018102000_anulacion_coherente_admite_devolucion (Paquete 4, M6.3). NO destructiva: ABORTA, sin tocar nada, si ya hay una `DEVOLUCION_PROVEEDOR` anulada (`RAISE EXCEPTION`), porque el CHECK anterior (solo VENTA y COMPRA) la rechazaría.
-- Si no hay ninguna, deja EXACTAMENTE la definición de 20261002160000_reglas_en_la_base_operacion_movimiento. Orden de la reversa del Paquete 4: M6.4, M6.3, M6.2 y M6.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261018102000_anulacion_coherente_admite_devolucion`. Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT count(*) INTO hay FROM "Operacion" WHERE proceso = 'DEVOLUCION_PROVEEDOR' AND "anuladaEn" IS NOT NULL;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar M6.3: hay % devolución(es) a proveedor anulada(s) y el CHECK anterior las rechaza.', hay;
  END IF;
END
$$;

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_anulacion_coherente_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_anulacion_coherente_chk" CHECK (
  ("anuladaPorId" IS NULL OR "anuladaEn" IS NOT NULL)
  AND ("anuladaEn" IS NULL OR proceso IN ('VENTA', 'COMPRA'))
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_anulacion_coherente_chk";
