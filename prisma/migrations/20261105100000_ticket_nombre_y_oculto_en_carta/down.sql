-- Reversa de 20261105100000_ticket_nombre_y_oculto_en_carta. NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si alguna línea de cuenta tiene un nombre congelado para el ticket o alguna foto de opción tiene
-- `ocultaEnCarta` en true: ese dato decide cómo se reimprimen tickets ya cerrados y no se borra en silencio. Primero decidir qué hacer con ellos (resguardarlos):
--   SELECT "id", "cuentaId", "nombreEnTicket" FROM "CuentaItem" WHERE "nombreEnTicket" IS NOT NULL;
--   SELECT "id", "cuentaItemId", "nombreOpcion" FROM "OpcionElegidaEnLinea" WHERE "ocultaEnCarta";
-- Sin datos (o si las columnas ya no existen), saca el CHECK y las columnas con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DO $$
DECLARE
  n_nombres bigint := 0;
  n_ocultas bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CuentaItem' AND column_name = 'nombreEnTicket') THEN
    EXECUTE 'SELECT count(*) FROM "CuentaItem" WHERE "nombreEnTicket" IS NOT NULL' INTO n_nombres;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OpcionElegidaEnLinea' AND column_name = 'ocultaEnCarta') THEN
    EXECUTE 'SELECT count(*) FROM "OpcionElegidaEnLinea" WHERE "ocultaEnCarta"' INTO n_ocultas;
  END IF;
  IF n_nombres > 0 OR n_ocultas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261105100000_ticket_nombre_y_oculto_en_carta: hay % línea(s) con nombre congelado para el ticket y % opción(es) ocultas en la carta al vender. Resguardalas (y decidí cómo se reimprimen esos tickets) antes de seguir.', n_nombres, n_ocultas;
  END IF;
END
$$;

ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_nombre_en_ticket_chk";
ALTER TABLE "CuentaItem" DROP COLUMN IF EXISTS "nombreEnTicket";
ALTER TABLE "OpcionElegidaEnLinea" DROP COLUMN IF EXISTS "ocultaEnCarta";
