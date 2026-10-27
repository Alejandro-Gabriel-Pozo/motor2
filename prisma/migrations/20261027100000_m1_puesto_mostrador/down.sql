-- Reversa de 20261027100000_m1_puesto_mostrador (M1 del mostrador, ADR-039). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si existe algún puesto MOSTRADOR o alguna cuenta de uno: sus cuentas lo
-- apuntan con RESTRICT, y bajar el tipo dejaría un «Mesa 0» sin nombre ni regla. Primero se cierran y se descartan las cuentas del mostrador desde la pantalla y se decide qué hacer con el puesto:
--   SELECT "id", "empresaId", "sucursalId" FROM "Mesa" WHERE "tipo" = 'MOSTRADOR';
--   SELECT "id", "mesaId" FROM "Cuenta" WHERE "tipoMesa" = 'MOSTRADOR';
-- Sin ninguno (o si las columnas ya no existen), recrea la FK ORIGINAL `Cuenta_empresaId_mesaId_fkey` (ON DELETE RESTRICT ON UPDATE CASCADE, migración 20260929100000) y saca columnas, CHECK e índice con IF EXISTS.
-- Idempotente. Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción), con `SET lock_timeout = '5s'`.
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA: con una que terminó bien da P3012, verificado en la base local):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261027100000_m1_puesto_mostrador' AND rolled_back_at IS NULL;

DO $$
DECLARE
  puestos bigint := 0;
  cuentas bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Mesa' AND column_name = 'tipo') THEN
    EXECUTE 'SELECT count(*) FROM "Mesa" WHERE "tipo" = ''MOSTRADOR''' INTO puestos;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Cuenta' AND column_name = 'tipoMesa') THEN
    EXECUTE 'SELECT count(*) FROM "Cuenta" WHERE "tipoMesa" = ''MOSTRADOR''' INTO cuentas;
  END IF;
  IF puestos > 0 OR cuentas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261027100000_m1_puesto_mostrador: hay % puesto(s) mostrador y % cuenta(s) de mostrador. Cerrá o descartá las cuentas y decidí qué hacer con el puesto antes de bajarla.', puestos, cuentas;
  END IF;
END
$$;

ALTER TABLE "Cuenta" DROP CONSTRAINT IF EXISTS "Cuenta_empresaId_mesaId_tipoMesa_fkey";
ALTER TABLE "Cuenta" DROP CONSTRAINT IF EXISTS "Cuenta_empresaId_mesaId_fkey";
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_mesaId_fkey" FOREIGN KEY ("empresaId", "mesaId") REFERENCES "Mesa"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cuenta" DROP CONSTRAINT IF EXISTS "Cuenta_comensales_segun_tipo_chk";
ALTER TABLE "Cuenta" DROP CONSTRAINT IF EXISTS "Cuenta_tipoMesa_chk";
ALTER TABLE "Cuenta" DROP COLUMN IF EXISTS "tipoMesa";

DROP INDEX IF EXISTS "Mesa_empresaId_id_tipo_key";
ALTER TABLE "Mesa" DROP CONSTRAINT IF EXISTS "Mesa_numero_segun_tipo_chk";
ALTER TABLE "Mesa" DROP CONSTRAINT IF EXISTS "Mesa_tipo_chk";
ALTER TABLE "Mesa" DROP COLUMN IF EXISTS "tipo";
