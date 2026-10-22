-- Reversa de 20261021130000_producto_modo_de_venta (Fase 4, C1). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si algún producto está en BASE_CONFIGURABLE (bajar la columna
-- lo volvería a vender en silencio a su precio guardado). Primero se vuelve cada base a «Directo» desde su pantalla (queda auditado) o se resguarda:
--   SELECT "id", "empresaId", "nombre", "precioVenta" FROM "Producto" WHERE "modoDeVenta" <> 'DIRECTO';
-- Sin bases (o si la columna ya no existe), saca los dos CHECK y la columna con IF EXISTS. Idempotente.
-- Volver primero el código (Instant Rollback) y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción), fuera del horario de servicio.
-- Después: `npx prisma migrate resolve --rolled-back 20261021130000_producto_modo_de_venta`.

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'modoDeVenta') THEN
    EXECUTE 'SELECT count(*) FROM "Producto" WHERE "modoDeVenta" <> ''DIRECTO''' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261021130000_producto_modo_de_venta: hay % producto(s) que se venden por opción (BASE_CONFIGURABLE). Volvelos a «Directo» desde su pantalla (o resguardalos) y decidí antes cómo seguir.', n;
    END IF;
  END IF;
END
$$;

ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_modoDeVenta_base_check", DROP CONSTRAINT IF EXISTS "Producto_modoDeVenta_check";
ALTER TABLE "Producto" DROP COLUMN IF EXISTS "modoDeVenta";
