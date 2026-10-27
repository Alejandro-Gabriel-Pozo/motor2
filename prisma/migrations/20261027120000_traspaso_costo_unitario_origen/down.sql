-- Reversa de 20261027120000_traspaso_costo_unitario_origen (E2, ADR-040: el costo viaja con el traspaso). NO destructiva y FALLA CERRADA: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún traspaso ya
-- tiene su costo copiado: bajar la columna lo perdería, y un envío todavía no aceptado entraría al destino sin costo con el código viejo. Primero se resguarda:
--   SELECT "id", "empresaId", "origenSucursalId", "destinoSucursalId", "estado", "costoUnitarioOrigen" FROM "TraspasoSucursal" WHERE "costoUnitarioOrigen" IS NOT NULL;
-- (las líneas de Kardex ya escritas conservan su precio: esta reversa no las toca). Sin ningún costo copiado (o si la columna ya no existe), saca el CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).
-- Después, marcarla revertida (`prisma migrate resolve --rolled-back` solo acepta una migración FALLIDA):
--   UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '20261027120000_traspaso_costo_unitario_origen' AND rolled_back_at IS NULL;

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TraspasoSucursal' AND column_name = 'costoUnitarioOrigen') THEN
    EXECUTE 'SELECT count(*) FROM "TraspasoSucursal" WHERE "costoUnitarioOrigen" IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261027120000_traspaso_costo_unitario_origen: hay % traspaso(s) con el costo del origen copiado. Bajarla lo perdería. Resguardalos y decidí antes cómo seguir.', n;
    END IF;
  END IF;
END
$$;

ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT IF EXISTS "TraspasoSucursal_costo_unitario_origen_no_negativo_chk";
ALTER TABLE "TraspasoSucursal" DROP COLUMN IF EXISTS "costoUnitarioOrigen";
