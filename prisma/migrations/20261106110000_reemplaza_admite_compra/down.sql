-- Reversa de 20261106110000_reemplaza_admite_compra. ABORTA si ya hay una compra que reemplaza a otra (no se puede volver a la regla «solo venta» sin perder ese enlace): primero hay que anular a mano esos enlaces,
-- con autorización. A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261106110000_reemplaza_admite_compra`.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operacion" WHERE "reemplazaAOperacionId" IS NOT NULL AND proceso = 'COMPRA') THEN
    RAISE EXCEPTION 'Hay compras corregidas por ejemplar (reemplazaAOperacionId en una COMPRA): no se baja esta migración.';
  END IF;
END
$$;

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_venta_o_compra_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_solo_venta_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_reemplaza_solo_venta_chk" CHECK (
  "reemplazaAOperacionId" IS NULL OR (proceso = 'VENTA' AND "reemplazaAOperacionId" <> id)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_reemplaza_solo_venta_chk";
