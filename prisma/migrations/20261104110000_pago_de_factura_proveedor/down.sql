-- Reversa de 20261104110000_pago_de_factura_proveedor (Pagos X0). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261104110000_pago_de_factura_proveedor`.
-- ABORTA si hay pagos declarados, anulaciones de pago o facturas `PENDIENTE_DE_PAGO` (se perdería cuándo y cómo se pagó, o el CHECK restaurado dejaría filas inválidas). Antes de decidir, mirar:
--   SELECT * FROM "PagoDeFacturaProveedor"; SELECT * FROM "AnulacionDePagoDeFacturaProveedor"; SELECT id FROM "FacturaProveedor" WHERE "condicionPago" = 'PENDIENTE_DE_PAGO';
-- IMPORTANTE: revertir el CÓDIGO de X0 antes (o a la vez): con el código nuevo y las tablas borradas, cargar una compra pendiente de pago fallaría. Idempotente (si ya está bajada, no falla).
DO $$
DECLARE
  pagos bigint;
  anulaciones bigint;
  pendientes bigint;
BEGIN
  pagos := 0; anulaciones := 0; pendientes := 0;
  IF to_regclass('"PagoDeFacturaProveedor"') IS NOT NULL THEN SELECT count(*) INTO pagos FROM "PagoDeFacturaProveedor"; END IF;
  IF to_regclass('"AnulacionDePagoDeFacturaProveedor"') IS NOT NULL THEN SELECT count(*) INTO anulaciones FROM "AnulacionDePagoDeFacturaProveedor"; END IF;
  SELECT count(*) INTO pendientes FROM "FacturaProveedor" WHERE "condicionPago" = 'PENDIENTE_DE_PAGO';
  IF pagos > 0 OR anulaciones > 0 OR pendientes > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261104110000_pago_de_factura_proveedor: hay % pago(s), % anulación(es) de pago y % factura(s) PENDIENTE_DE_PAGO', pagos, anulaciones, pendientes;
  END IF;
END
$$;

DROP TABLE IF EXISTS "AnulacionDePagoDeFacturaProveedor";
DROP TABLE IF EXISTS "PagoDeFacturaProveedor";

ALTER TABLE "FacturaProveedor" DROP CONSTRAINT IF EXISTS "FacturaProveedor_condicion_pago_chk";
ALTER TABLE "FacturaProveedor" ADD CONSTRAINT "FacturaProveedor_condicion_pago_chk" CHECK ("condicionPago" IN ('CONTADO_PAGADA'));
